#!/usr/bin/env bash
# =============================================================================
#  Smart-Shop — test de concurrence sur le stock
# =============================================================================
#  Exigé par CLAUDE.md règle 11.4 : N commandes simultanées sur un stock de M
#  doivent produire EXACTEMENT M succès et N-M réponses 409.
#
#  C'est la preuve directe du verrou pessimiste `SELECT ... FOR UPDATE` émis
#  par prisma.$queryRaw dans order.repository.ts. Sans ce verrou, plusieurs
#  replicas liraient le même stock avant de le décrémenter, et le stock
#  passerait sous zéro — ou la contrainte CHECK rejetterait des commandes
#  qui auraient dû aboutir.
#
#  Le test vise la stack DÉPLOYÉE : les requêtes passent par le routing mesh
#  et se répartissent sur les 3 replicas. C'est précisément la situation que
#  le verrou doit protéger.
#
#  Usage :  ./scripts/concurrency-test.sh [URL] [STOCK] [REQUETES]
#  Défaut : http://127.0.0.1:3000  stock=5  requêtes=10
# =============================================================================
set -uo pipefail

API="${1:-http://127.0.0.1:3000}"
STOCK="${2:-5}"
REQUETES="${3:-10}"
ATTENDU_OK="$STOCK"
ATTENDU_409=$((REQUETES - STOCK))

TRAVAIL=$(mktemp -d)
nettoyer() { rm -rf "$TRAVAIL"; }
trap nettoyer EXIT

echo "═══════════════════════════════════════════════════════════"
echo " Test de concurrence sur le stock"
echo " $(date '+%Y-%m-%d %H:%M:%S')"
echo "═══════════════════════════════════════════════════════════"
echo " Cible          : $API"
echo " Stock initial  : $STOCK"
echo " Requêtes       : $REQUETES simultanées, 1 unité chacune"
echo " Attendu        : $ATTENDU_OK × 201, $ATTENDU_409 × 409"
echo

# --- Replicas réellement en service ----------------------------------------
if command -v docker > /dev/null 2>&1; then
  R=$(docker service ls --filter name=catalogue-api --format '{{.Replicas}}' 2>/dev/null | head -1)
  [ -n "$R" ] && echo " Replicas servant les requêtes : $R"
fi

# --- 1. Produit dédié, stock maîtrisé --------------------------------------
REF="SS-CONC-$(date +%s)"
CREATION=$(curl -s -X POST "$API/products" -H 'content-type: application/json' \
  -d "{\"reference\":\"$REF\",\"name\":\"Produit test concurrence\",\"price\":\"10.00\",\"stock\":$STOCK}")
PID=$(printf '%s' "$CREATION" | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["id"])' 2>/dev/null)

if [ -z "${PID:-}" ]; then
  echo " ✗ Création du produit impossible : $CREATION" >&2
  exit 1
fi
echo " Produit créé   : $REF ($PID)"
echo

# --- 2. Rafale simultanée ---------------------------------------------------
# Les requêtes sont lancées en arrière-plan sans délai entre elles : elles
# atteignent les replicas pendant la même fenêtre de quelques millisecondes.
echo " Envoi de $REQUETES requêtes simultanées…"
DEBUT=$(python3 -c 'import time;print(time.time())')

for i in $(seq 1 "$REQUETES"); do
  (
    curl -s -o "$TRAVAIL/corps-$i" -w '%{http_code}' \
      -X POST "$API/orders" -H 'content-type: application/json' \
      -d "{\"customerName\":\"Client concurrent $i\",\"items\":[{\"productId\":\"$PID\",\"quantity\":1}]}" \
      > "$TRAVAIL/code-$i" 2>/dev/null
  ) &
done
wait

FIN=$(python3 -c 'import time;print(time.time())')
DUREE=$(python3 -c "print(f'{($FIN - $DEBUT)*1000:.0f}')")
echo " Terminé en ${DUREE} ms"
echo

# --- 3. Dépouillement -------------------------------------------------------
OK=0; CONFLIT=0; AUTRE=0
declare -a INATTENDUS
for i in $(seq 1 "$REQUETES"); do
  CODE=$(cat "$TRAVAIL/code-$i" 2>/dev/null || echo "000")
  case "$CODE" in
    201) OK=$((OK + 1)) ;;
    409) CONFLIT=$((CONFLIT + 1)) ;;
    *)   AUTRE=$((AUTRE + 1)); INATTENDUS+=("requête $i → $CODE : $(head -c 120 "$TRAVAIL/corps-$i" 2>/dev/null)") ;;
  esac
done

STOCK_FINAL=$(curl -s "$API/products/$PID" \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["stock"])' 2>/dev/null || echo "?")

echo "───────────────────────────────────────────────────────────"
printf ' 201 Created          : %-3s (attendu %s)\n' "$OK" "$ATTENDU_OK"
printf ' 409 Stock insuffisant: %-3s (attendu %s)\n' "$CONFLIT" "$ATTENDU_409"
printf ' Autres codes         : %-3s (attendu 0)\n' "$AUTRE"
printf ' Stock final          : %-3s (attendu 0)\n' "$STOCK_FINAL"
echo "───────────────────────────────────────────────────────────"

for u in "${INATTENDUS[@]:-}"; do [ -n "$u" ] && echo " ⚠ $u"; done

# --- 4. Verdict -------------------------------------------------------------
ECHEC=0
[ "$OK" -eq "$ATTENDU_OK" ]      || { echo " ✗ Nombre de succès incorrect"; ECHEC=1; }
[ "$CONFLIT" -eq "$ATTENDU_409" ] || { echo " ✗ Nombre de conflits incorrect"; ECHEC=1; }
[ "$AUTRE" -eq 0 ]                || { echo " ✗ Codes de statut inattendus"; ECHEC=1; }
[ "$STOCK_FINAL" = "0" ]          || { echo " ✗ Stock final incohérent"; ECHEC=1; }

echo
if [ "$ECHEC" -eq 0 ]; then
  echo " ✓ SUCCÈS — le stock n'a jamais été survendu."
  echo "   Exactement $ATTENDU_OK commandes ont abouti sur un stock de $STOCK,"
  echo "   malgré $REQUETES requêtes concurrentes réparties sur les replicas."
  echo "   Le verrou SELECT ... FOR UPDATE a sérialisé les accès."
else
  echo " ✗ ÉCHEC — l'intégrité du stock n'est pas garantie."
fi

# --- 5. Nettoyage -----------------------------------------------------------
for i in $(seq 1 "$REQUETES"); do
  ID=$(python3 -c "
import json
try:
    print(json.load(open('$TRAVAIL/corps-$i')).get('data',{}).get('id',''))
except Exception:
    print('')
" 2>/dev/null)
  [ -n "$ID" ] && curl -s -o /dev/null -X DELETE "$API/orders/$ID"
done
curl -s -o /dev/null -X DELETE "$API/products/$PID"
echo
echo " (produit et commandes de test supprimés)"

exit "$ECHEC"
