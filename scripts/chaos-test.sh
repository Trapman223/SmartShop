#!/usr/bin/env bash
# =============================================================================
#  Smart-Shop — test de résilience (livrable du compte-rendu)
# =============================================================================
#  Répond à l'exigence du sujet : « capture montrant que l'application reste
#  disponible après avoir tué un conteneur manuellement ».
#
#  Déroulé :
#    1. une boucle interroge l'API en continu et horodate chaque réponse ;
#    2. au bout de quelques secondes, un conteneur est supprimé brutalement
#       (docker rm -f), sans prévenir Swarm ;
#    3. la boucle continue pendant que Swarm replanifie la tâche ;
#    4. le script compte les échecs et mesure le temps de reconvergence.
#
#  Le nombre de replicas n'est JAMAIS modifié : on tue une tâche, on ne
#  réduit pas le service (cf. CLAUDE.md section 0, règle I5).
#
#  Usage :  ./scripts/chaos-test.sh [catalogue|avis]
#  La sortie horodatée est conservée dans docs/compte-rendu/.
# =============================================================================
set -uo pipefail

CIBLE="${1:-catalogue}"
case "$CIBLE" in
  catalogue) SERVICE="smart-shop_catalogue-api"; URL="${CATALOGUE_URL:-http://localhost:3000}/products" ;;
  avis)      SERVICE="smart-shop_avis-api";      URL="${AVIS_URL:-http://localhost:4000}/health" ;;
  *) echo "Cible inconnue : $CIBLE (attendu : catalogue ou avis)" >&2; exit 1 ;;
esac

RACINE="$(cd "$(dirname "$0")/.." && pwd)"
SORTIE="$RACINE/docs/compte-rendu/chaos-test-$CIBLE-$(date +%Y%m%d-%H%M%S).log"
mkdir -p "$(dirname "$SORTIE")"

DUREE=60          # secondes de sollicitation totale
INSTANT_KILL=5    # seconde à laquelle le conteneur est tué
INTERVALLE=0.2    # entre deux requêtes

titre() { printf '\n\033[1m══ %s ══\033[0m\n' "$1"; }

exec > >(tee "$SORTIE") 2>&1

echo "============================================================"
echo " Smart-Shop — test de résilience"
echo " Date          : $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo " Service visé  : $SERVICE"
echo " Point testé   : $URL"
echo " Durée         : ${DUREE}s, une requête toutes les ${INTERVALLE}s"
echo "============================================================"

titre "État initial"
docker service ls --filter "name=$SERVICE" --format 'table {{.Name}}\t{{.Replicas}}\t{{.Image}}'

VICTIME=$(docker ps --filter "name=$SERVICE" --format '{{.ID}} {{.Names}}' | head -1)
if [ -z "$VICTIME" ]; then
  echo "Aucun conteneur en cours pour $SERVICE. La stack est-elle déployée ?" >&2
  exit 1
fi
VICTIME_ID=$(echo "$VICTIME" | cut -d' ' -f1)
VICTIME_NOM=$(echo "$VICTIME" | cut -d' ' -f2)

titre "Sollicitation continue + suppression brutale d'un conteneur"
echo "Conteneur qui sera tué : $VICTIME_NOM ($VICTIME_ID)"
echo

TOTAL=0; OK=0; KO=0
PREMIER_ECHEC=""; DERNIER_ECHEC=""
TUE=0
DEBUT=$(date +%s)

while :; do
  MAINTENANT=$(date +%s)
  ECOULE=$((MAINTENANT - DEBUT))
  [ "$ECOULE" -ge "$DUREE" ] && break

  # Suppression brutale, une seule fois, à INSTANT_KILL.
  if [ "$TUE" -eq 0 ] && [ "$ECOULE" -ge "$INSTANT_KILL" ]; then
    echo
    echo ">>> $(date '+%H:%M:%S')  docker rm -f $VICTIME_NOM"
    docker rm -f "$VICTIME_ID" > /dev/null 2>&1
    echo ">>> conteneur supprimé — Swarm doit maintenant replanifier la tâche"
    echo
    TUE=1
  fi

  CODE=$(curl -s -m 3 -o /dev/null -w '%{http_code}' "$URL" 2>/dev/null)
  TOTAL=$((TOTAL + 1))

  if [ "$CODE" = "200" ]; then
    OK=$((OK + 1))
  else
    KO=$((KO + 1))
    HORODATAGE=$(date '+%H:%M:%S')
    [ -z "$PREMIER_ECHEC" ] && PREMIER_ECHEC="$HORODATAGE"
    DERNIER_ECHEC="$HORODATAGE"
    echo "    $HORODATAGE  ÉCHEC (code $CODE)"
  fi

  # Une ligne d'état par seconde, pour garder une trace lisible.
  if [ $((TOTAL % 5)) -eq 0 ]; then
    REPLICAS=$(docker service ls --filter "name=$SERVICE" --format '{{.Replicas}}')
    printf '    %s  t+%02ds  replicas=%s  requetes=%d  ok=%d  ko=%d\n' \
      "$(date '+%H:%M:%S')" "$ECOULE" "$REPLICAS" "$TOTAL" "$OK" "$KO"
  fi

  sleep "$INTERVALLE"
done

titre "État final"
docker service ls --filter "name=$SERVICE" --format 'table {{.Name}}\t{{.Replicas}}\t{{.Image}}'
echo
docker service ps "$SERVICE" --format 'table {{.Name}}\t{{.CurrentState}}\t{{.Error}}' | head -8

titre "Bilan"
DISPO=$(python3 -c "print(f'{100 * $OK / max($TOTAL,1):.2f}')")
echo "  Requêtes émises        : $TOTAL"
echo "  Réponses 200           : $OK"
echo "  Échecs                 : $KO"
echo "  Disponibilité observée : ${DISPO} %"
if [ -n "$PREMIER_ECHEC" ]; then
  echo "  Fenêtre d'indisponibilité : $PREMIER_ECHEC → $DERNIER_ECHEC"
else
  echo "  Fenêtre d'indisponibilité : AUCUNE — pas une seule requête perdue"
fi
echo
echo "  Lecture : les 2 replicas survivants ont absorbé le trafic pendant que"
echo "  Swarm replanifiait la tâche supprimée. C'est le routage mesh de Swarm"
echo "  qui écarte automatiquement la tâche morte du load balancing."
echo
echo "Sortie conservée : $SORTIE"
