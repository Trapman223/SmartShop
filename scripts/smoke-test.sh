#!/usr/bin/env bash
# =============================================================================
#  Smart-Shop — parcours fonctionnel complet contre la stack déployée
# =============================================================================
#  Vérifie, sur le cluster Swarm réel et non sur des mocks :
#    1. les deux API répondent et leurs bases sont joignables ;
#    2. le parcours métier bout en bout (produit → commande → stock → avis →
#       recommandations → annulation → restitution du stock) ;
#    3. les DEUX flux de communication inter-services ;
#    4. l'intégrité du stock sous concurrence, avec 3 replicas actifs.
#
#  Usage :  ./scripts/smoke-test.sh
#  Prérequis : la stack tourne (docker stack deploy -c docker-stack.yml smart-shop)
# =============================================================================
set -uo pipefail

CATALOGUE="${CATALOGUE_URL:-http://localhost:3000}"
AVIS="${AVIS_URL:-http://localhost:4000}"
REF="SS-SMOKE-$(date +%s)"
CLIENT="smoke-$(date +%s)"

vert()  { printf '\033[32m✓\033[0m %s\n' "$1"; }
rouge() { printf '\033[31m✗\033[0m %s\n' "$1"; }
titre() { printf '\n\033[1m══ %s ══\033[0m\n' "$1"; }

ECHECS=0
verifier() {
  local libelle="$1" attendu="$2" obtenu="$3"
  if [ "$attendu" = "$obtenu" ]; then
    vert "$libelle"
  else
    rouge "$libelle (attendu : $attendu — obtenu : $obtenu)"
    ECHECS=$((ECHECS + 1))
  fi
}

gql() {
  curl -s -m 10 -X POST "$AVIS/graphql" \
    -H 'Content-Type: application/json' -d "{\"query\":\"$1\"}"
}

# ---------------------------------------------------------------------------
titre "1. Disponibilité des deux services"
# ---------------------------------------------------------------------------
verifier "catalogue-api /ready" "ready" \
  "$(curl -s -m 10 "$CATALOGUE/ready" | python3 -c 'import json,sys;print(json.load(sys.stdin)["status"])' 2>/dev/null)"
verifier "avis-api /ready" "ready" \
  "$(curl -s -m 10 "$AVIS/ready" | python3 -c 'import json,sys;print(json.load(sys.stdin)["status"])' 2>/dev/null)"

# ---------------------------------------------------------------------------
titre "2. Catalogue : création d'un produit (PostgreSQL)"
# ---------------------------------------------------------------------------
PRODUIT=$(curl -s -m 10 -X POST "$CATALOGUE/products" -H 'Content-Type: application/json' \
  -d "{\"reference\":\"$REF\",\"name\":\"Produit smoke-test\",\"price\":\"20.00\",\"stock\":5}")
PRODUCT_ID=$(echo "$PRODUIT" | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["id"])' 2>/dev/null)

if [ -n "${PRODUCT_ID:-}" ]; then
  vert "produit créé  ($REF, stock 5)"
else
  rouge "création du produit échouée : $PRODUIT"
  echo; echo "Abandon : la suite du parcours en dépend."; exit 1
fi

# ---------------------------------------------------------------------------
titre "3. Commande : décrément transactionnel du stock"
# ---------------------------------------------------------------------------
COMMANDE=$(curl -s -m 10 -X POST "$CATALOGUE/orders" -H 'Content-Type: application/json' \
  -d "{\"customerName\":\"Amina Diallo\",\"items\":[{\"productId\":\"$PRODUCT_ID\",\"quantity\":2}]}")
ORDER_ID=$(echo "$COMMANDE" | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["id"])' 2>/dev/null)
TOTAL=$(echo "$COMMANDE" | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["total"])' 2>/dev/null)

verifier "commande créée, total calculé" "40.00" "${TOTAL:-absent}"
verifier "stock décrémenté 5 → 3" "3" \
  "$(curl -s -m 10 "$CATALOGUE/products/$PRODUCT_ID" | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["stock"])' 2>/dev/null)"

# ---------------------------------------------------------------------------
titre "4. Avis & recommandations (MongoDB)"
# ---------------------------------------------------------------------------
AVIS_CREE=$(gql "mutation{createReview(input:{userId:\\\"$CLIENT\\\",productId:\\\"$REF\\\",rating:5,comment:\\\"Excellent, conforme a la description.\\\",tags:[\\\"qualite\\\"]}){id}}")
REVIEW_ID=$(echo "$AVIS_CREE" | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["createReview"]["id"])' 2>/dev/null)
[ -n "${REVIEW_ID:-}" ] && vert "avis posté" || { rouge "avis non posté : $AVIS_CREE"; ECHECS=$((ECHECS + 1)); }

MODIFIE=$(gql "mutation{updateReview(id:\\\"${REVIEW_ID:-x}\\\",input:{rating:4}){rating}}")
verifier "avis modifié (5 → 4)" "4" \
  "$(echo "$MODIFIE" | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["updateReview"]["rating"])' 2>/dev/null)"

gql "mutation{trackBrowsingEvent(input:{userId:\\\"$CLIENT\\\",productId:\\\"$REF\\\",category:\\\"audio\\\",eventType:VIEW}){id}}" > /dev/null
RECOS=$(gql "{recommendations(userId:\\\"$CLIENT\\\",limit:5){productId score reason}}")
echo "$RECOS" | grep -q '"recommendations"' \
  && vert "recommandations servies" \
  || { rouge "recommandations indisponibles : $RECOS"; ECHECS=$((ECHECS + 1)); }

# ---------------------------------------------------------------------------
titre "5. Flux 1 — avis-api interroge catalogue-api (REST)"
# ---------------------------------------------------------------------------
FLUX1=$(gql "{productsReviews(productId:\\\"$REF\\\"){items{product{reference name price}}}}")
verifier "le produit remonte dans GraphQL" "$REF" \
  "$(echo "$FLUX1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["productsReviews"]["items"][0]["product"]["reference"])' 2>/dev/null)"

# ---------------------------------------------------------------------------
titre "6. Flux 2 — catalogue-api interroge avis-api (GraphQL)"
# ---------------------------------------------------------------------------
FLUX2=$(curl -s -m 10 "$CATALOGUE/products?q=$REF")
verifier "la note remonte dans GET /products" "4.0" \
  "$(echo "$FLUX2" | python3 -c 'import json,sys;print(float(json.load(sys.stdin)["data"][0]["rating"]["average"]))' 2>/dev/null)"

# ---------------------------------------------------------------------------
titre "7. Intégrité du stock sous concurrence (3 replicas)"
# ---------------------------------------------------------------------------
#  Stock restant : 3. On lance 10 commandes d'une unité EN PARALLÈLE.
#  Sans SELECT ... FOR UPDATE, plusieurs replicas liraient le même stock et
#  le feraient passer sous zéro. Attendu : exactement 3 succès, 7 refus.
# ---------------------------------------------------------------------------
TMP=$(mktemp -d)
for i in $(seq 1 10); do
  curl -s -m 15 -o /dev/null -w '%{http_code}\n' -X POST "$CATALOGUE/orders" \
    -H 'Content-Type: application/json' \
    -d "{\"customerName\":\"Concurrent $i\",\"items\":[{\"productId\":\"$PRODUCT_ID\",\"quantity\":1}]}" \
    > "$TMP/$i" &
done
wait

SUCCES=$(cat "$TMP"/* | grep -c '^201$')
CONFLITS=$(cat "$TMP"/* | grep -c '^409$')
rm -rf "$TMP"

verifier "commandes acceptées (= stock disponible)" "3" "$SUCCES"
verifier "commandes refusées en 409 (stock épuisé)" "7" "$CONFLITS"
verifier "stock jamais négatif" "0" \
  "$(curl -s -m 10 "$CATALOGUE/products/$PRODUCT_ID" | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["stock"])' 2>/dev/null)"

# ---------------------------------------------------------------------------
titre "8. Annulation : restitution transactionnelle du stock"
# ---------------------------------------------------------------------------
CODE=$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X DELETE "$CATALOGUE/orders/${ORDER_ID:-x}")
verifier "DELETE /orders/{id}" "204" "$CODE"
verifier "stock restitué 0 → 2" "2" \
  "$(curl -s -m 10 "$CATALOGUE/products/$PRODUCT_ID" | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["stock"])' 2>/dev/null)"

# ---------------------------------------------------------------------------
titre "Résultat"
# ---------------------------------------------------------------------------
if [ "$ECHECS" -eq 0 ]; then
  vert "parcours complet validé contre la stack Swarm"
  exit 0
fi
rouge "$ECHECS vérification(s) en échec"
exit 1
