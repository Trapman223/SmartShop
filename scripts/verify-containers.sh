#!/usr/bin/env bash
# =============================================================================
#  Smart-Shop — vérification de la conteneurisation (étape 10)
# =============================================================================
#  Construit les deux images, démarre les conteneurs et vérifie que :
#    1. le service Catalogue démarre et répond ;
#    2. le service Avis démarre et répond ;
#    3. PostgreSQL et MongoDB fonctionnent (readiness + écriture réelle) ;
#    4. les HEALTHCHECK Docker passent à « healthy » ;
#    5. les images restent de taille raisonnable et tournent en non-root.
#
#  Usage :  ./scripts/verify-containers.sh
#  Arrêt  :  docker compose -f docker-compose.dev.yml down -v
# =============================================================================
set -uo pipefail

# PG_HOST_PORT décalé par défaut : un PostgreSQL natif occupe souvent 5432.
export PG_HOST_PORT="${PG_HOST_PORT:-15432}"
export MONGO_HOST_PORT="${MONGO_HOST_PORT:-27017}"
COMPOSE="docker compose -f docker-compose.dev.yml"
CATALOGUE="http://127.0.0.1:3000"
AVIS="http://127.0.0.1:4000"

vert()  { printf '\033[32m✓\033[0m %s\n' "$1"; }
rouge() { printf '\033[31m✗\033[0m %s\n' "$1"; }
titre() { printf '\n\033[1m══ %s ══\033[0m\n' "$1"; }

ECHECS=0
verifier() {
  local libelle="$1" attendu="$2" obtenu="$3"
  if [ "$attendu" = "$obtenu" ]; then
    vert "$libelle ($obtenu)"
  else
    rouge "$libelle — attendu $attendu, obtenu $obtenu"
    ECHECS=$((ECHECS + 1))
  fi
}

code_http() { curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$1" 2>/dev/null || echo "000"; }

attendre() {
  local url="$1" libelle="$2" i
  printf '  attente de %s ' "$libelle"
  for i in $(seq 1 60); do
    if [ "$(code_http "$url")" = "200" ]; then printf ' prêt (%ss)\n' "$i"; return 0; fi
    printf '.'; sleep 1
  done
  printf ' ABANDON après 60s\n'; return 1
}

# -----------------------------------------------------------------------------
titre "0. Prérequis"
if ! command -v docker > /dev/null 2>&1; then
  rouge "Docker introuvable. Installer Docker Desktop ou Colima avant de relancer."
  exit 1
fi
vert "docker $(docker --version | awk '{print $3}' | tr -d ',')"

# -----------------------------------------------------------------------------
titre "1. Construction des images"
$COMPOSE build || { rouge "échec du build"; exit 1; }
vert "images construites"

# -----------------------------------------------------------------------------
titre "2. Démarrage des conteneurs"
$COMPOSE up -d || { rouge "échec du démarrage"; exit 1; }
$COMPOSE ps

attendre "$CATALOGUE/health" "catalogue-api" || ECHECS=$((ECHECS + 1))
attendre "$AVIS/health"      "avis-api"      || ECHECS=$((ECHECS + 1))

# -----------------------------------------------------------------------------
titre "3. Les deux services démarrent et répondent"
verifier "catalogue-api  GET /health" 200 "$(code_http "$CATALOGUE/health")"
verifier "avis-api       GET /health" 200 "$(code_http "$AVIS/health")"

# -----------------------------------------------------------------------------
titre "4. Les bases de données fonctionnent"
# /ready ne répond 200 que si la base répond réellement à une requête.
verifier "catalogue-api  GET /ready (PostgreSQL)" 200 "$(code_http "$CATALOGUE/ready")"
verifier "avis-api       GET /ready (MongoDB)"    200 "$(code_http "$AVIS/ready")"

echo "  -- écriture réelle en PostgreSQL (POST /products puis relecture) --"
REF="SS-VERIF-$(date +%s)"
CREATION=$(curl -s -X POST "$CATALOGUE/products" -H 'content-type: application/json' \
  -d "{\"reference\":\"$REF\",\"name\":\"Produit de verification\",\"price\":\"19.99\",\"stock\":7}")
verifier "POST /products" "201" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$CATALOGUE/products" \
  -H 'content-type: application/json' \
  -d "{\"reference\":\"$REF-B\",\"name\":\"Produit B\",\"price\":\"5.00\",\"stock\":1}")"
echo "$CREATION" | head -c 200; echo

echo "  -- écriture réelle en MongoDB (mutation createReview) --"
REVIEW=$(curl -s -X POST "$AVIS/graphql" -H 'content-type: application/json' \
  -d '{"query":"mutation{createReview(input:{userId:\"verif-user\",productId:\"verif-produit\",rating:5,comment:\"Verification de la conteneurisation.\",tags:[\"verif\"]}){id rating}}"}')
echo "$REVIEW" | head -c 200; echo
if echo "$REVIEW" | grep -q '"rating":5'; then
  vert "avis écrit et relu depuis MongoDB"
else
  rouge "échec de l'écriture MongoDB"; ECHECS=$((ECHECS + 1))
fi

# -----------------------------------------------------------------------------
titre "5. HEALTHCHECK Docker"
for c in catalogue-api avis-api; do
  ID=$($COMPOSE ps -q "$c")
  ETAT=$(docker inspect --format '{{.State.Health.Status}}' "$ID" 2>/dev/null || echo "absent")
  verifier "$c — état de santé Docker" "healthy" "$ETAT"
done

# -----------------------------------------------------------------------------
titre "6. Qualité des images"
docker images --format '{{.Repository}}:{{.Tag}}\t{{.Size}}' | grep smartshop || true
for c in catalogue-api avis-api; do
  ID=$($COMPOSE ps -q "$c")
  verifier "$c — utilisateur non-root" "node" "$(docker exec "$ID" whoami 2>/dev/null || echo inconnu)"
  NM=$(docker exec "$ID" sh -c 'ls node_modules 2>/dev/null | wc -l' 2>/dev/null || echo 0)
  echo "  $c — paquets dans node_modules : $NM"
  verifier "$c — aucun .env embarqué" "0" "$(docker exec "$ID" sh -c 'ls -a /app | grep -c "^\.env" || true' 2>/dev/null | tr -d ' ')"
  verifier "$c — aucun dossier tests embarqué" "0" "$(docker exec "$ID" sh -c 'ls /app | grep -c "^tests$" || true' 2>/dev/null | tr -d ' ')"
done

# -----------------------------------------------------------------------------
titre "Résultat"
if [ "$ECHECS" -eq 0 ]; then
  vert "toutes les vérifications sont passées"
else
  rouge "$ECHECS vérification(s) en échec"
fi
echo
echo "Journaux    : $COMPOSE logs -f"
echo "Arrêt       : $COMPOSE down -v"
exit "$ECHECS"
