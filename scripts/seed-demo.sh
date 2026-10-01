#!/usr/bin/env bash
# =============================================================================
#  Smart-Shop — jeu de données de démonstration pour les captures d'écran
# =============================================================================
#  Crée un catalogue réaliste, des avis variés et un historique de navigation
#  cohérent, afin que les captures du compte-rendu montrent des résultats
#  présentables plutôt que des résidus de tests.
#
#  --purge  supprime d'abord les données laissées par les scripts de test
#           (références SS-SMOKE-*, SS-CONC-*, SS-T*, p-*, verif-*).
#
#  Idempotent : relancer le script ne crée pas de doublons.
#
#  Usage :  ./scripts/seed-demo.sh [--purge]
# =============================================================================
set -uo pipefail

CAT="${CATALOGUE_URL:-http://localhost:3000}"
AVIS="${AVIS_URL:-http://localhost:4000/graphql}"

if [ "${1:-}" = "--purge" ]; then
  echo "Purge des données de test…"
  CID=$(docker ps --filter name=smart-shop_mongodb --format '{{.ID}}' | head -1)
  AID=$(docker ps --filter name=smart-shop_avis-api --format '{{.ID}}' | head -1)
  URI=$(docker exec "$AID" sh -c 'cat /run/secrets/avis_mongodb_uri' 2>/dev/null)
  docker exec "$CID" mongosh "$URI" --quiet --eval '
    // Seul le catalogue de demonstration est conserve ; le reste provient
    // des scripts de test. (Sans apostrophe : la chaine est entre quotes simples.)
    const motif = { $not: /^SS-PRD-0000[1-7]$/ };
    const a = db.reviews.deleteMany({ productId: motif }).deletedCount;
    // Lhistorique de navigation des clients de demonstration est entierement
    // reconstruit a chaque passage : sinon une consultation dun passage
    // precedent exclurait durablement un produit des recommandations.
    const b = db.browsing_events.deleteMany({
      $or: [{ productId: motif }, { userId: /^u-00[1-6]$/ }]
    }).deletedCount;
    print("  " + a + " avis et " + b + " evenements supprimes");
  ' 2>&1 | tail -2
  echo
fi

# Les charges utiles sont construites par python3 : l'échappement des
# guillemets dans une requête GraphQL imbriquée en JSON est trop fragile à
# écrire en shell.
python3 - "$CAT" "$AVIS" << 'PY'
import json, sys, urllib.request

CAT, AVIS = sys.argv[1], sys.argv[2]

def post(url, charge):
    requete = urllib.request.Request(
        url, data=json.dumps(charge).encode(),
        headers={'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(requete, timeout=10) as r:
            return json.loads(r.read())
    except Exception as e:
        return {'erreur': str(e)}

def gql(requete, variables):
    return post(AVIS, {'query': requete, 'variables': variables})

print('Jeu de démonstration Smart-Shop\n')

# --- 1. Catalogue ---------------------------------------------------------
PRODUITS = [
    ('SS-PRD-00001', 'Casque audio sans fil',        "Réduction de bruit active, 30 h d'autonomie.",     '129.90', 42),
    ('SS-PRD-00002', 'Clavier mécanique compact',    'Format 65 %, switches linéaires, rétroéclairage.',  '89.00', 17),
    ('SS-PRD-00003', 'Souris ergonomique verticale', 'Capteur 4000 dpi, réduit la tension du poignet.',   '54.50', 63),
    ('SS-PRD-00004', 'Écran 27 pouces QHD',          'Dalle IPS 144 Hz, pied réglable en hauteur.',      '319.99',  8),
    ('SS-PRD-00005', "Station d'accueil USB-C",      '11 ports, charge 100 W, double sortie vidéo.',     '149.00', 24),
    ('SS-PRD-00006', 'Micro-casque de conférence',   'Perche antibruit, certifié visioconférence.',       '79.00', 12),
    ('SS-PRD-00007', 'Enceinte Bluetooth portable',  'Autonomie 12 h, résistante aux projections.',       '59.90', 31),
]
crees = 0
for ref, nom, desc, prix, stock in PRODUITS:
    r = post(f'{CAT}/products', {'reference': ref, 'name': nom,
                                 'description': desc, 'price': prix, 'stock': stock})
    if 'data' in r:
        crees += 1
print(f'  Produits            : {crees} créé(s), {len(PRODUITS) - crees} déjà présent(s)')

# --- 2. Avis : notes contrastées pour un classement parlant ---------------
M_AVIS = """mutation($i: CreateReviewInput!) { createReview(input: $i) { id } }"""
AVIS_DEMO = [
    ('u-002', 'SS-PRD-00001', 5, "Excellent casque, l'autonomie annoncée est tenue.", ['qualite', 'autonomie']),
    ('u-003', 'SS-PRD-00001', 5, 'Confort remarquable sur de longues sessions.',       ['confort']),
    ('u-004', 'SS-PRD-00001', 4, 'Très bon, le micro est un peu juste en visio.',      ['qualite']),
    ('u-002', 'SS-PRD-00006', 5, 'Parfait pour les réunions, collègues ravis.',        ['qualite', 'visio']),
    ('u-003', 'SS-PRD-00006', 4, 'Bonne isolation, le câble est un peu court.',        ['confort']),
    ('u-005', 'SS-PRD-00002', 3, 'Correct, mais les touches sont bruyantes.',          ['bruit']),
    ('u-002', 'SS-PRD-00004', 5, 'Image superbe, le 144 Hz change tout.',              ['qualite']),
    ('u-006', 'SS-PRD-00003', 2, "Prise en main difficile, je n'ai pas accroché.",     ['confort']),
    ('u-005', 'SS-PRD-00007', 3, 'Son correct, mais les basses manquent de corps.',     ['son']),
]
n = sum(1 for u, p, note, c, t in AVIS_DEMO
        if 'errors' not in gql(M_AVIS, {'i': {'userId': u, 'productId': p,
                                              'rating': note, 'comment': c, 'tags': t}}))
print(f'  Avis clients        : {n} créé(s), {len(AVIS_DEMO) - n} déjà présent(s)')

# --- 3. Historique : u-001 consulte surtout la catégorie « audio » --------
#  La recommandation doit donc faire remonter CATEGORY_AFFINITY, et pas
#  seulement HIGHLY_RATED — c'est ce qui rend la capture démonstrative.
M_NAV = """mutation($i: TrackBrowsingEventInput!) { trackBrowsingEvent(input: $i) { id } }"""
NAVIGATION = [
    # u-001 ne consulte que le casque (audio). SS-PRD-00006 est lui aussi
    # en audio et n'a pas été vu : il doit remonter par affinité de catégorie.
    ('u-001', 'SS-PRD-00001', 'audio'), ('u-001', 'SS-PRD-00001', 'audio'),
    ('u-001', 'SS-PRD-00001', 'audio'), ('u-001', 'SS-PRD-00001', 'audio'),
    ('u-001', 'SS-PRD-00002', 'peripherique'),
    ('u-002', 'SS-PRD-00001', 'audio'), ('u-002', 'SS-PRD-00006', 'audio'),
    ('u-003', 'SS-PRD-00001', 'audio'), ('u-003', 'SS-PRD-00004', 'ecran'),
    ('u-004', 'SS-PRD-00006', 'audio'), ('u-006', 'SS-PRD-00006', 'audio'), ('u-005', 'SS-PRD-00007', 'audio'), ('u-005', 'SS-PRD-00003', 'peripherique'),
    ('u-005', 'SS-PRD-00005', 'accessoire'),
]
for u, p, cat in NAVIGATION:
    gql(M_NAV, {'i': {'userId': u, 'productId': p, 'category': cat, 'eventType': 'VIEW'}})
print(f'  Navigation          : {len(NAVIGATION)} événement(s)')

# --- 4. Aperçu du résultat ------------------------------------------------
print('\nRecommandations pour u-001 :')
r = gql('{ recommendations(userId: "u-001", limit: 4) '
        '{ productId score reason explanation } }', {})
for reco in r.get('data', {}).get('recommendations', []):
    print(f"  {reco['productId']:16} {reco['score']:<6} {reco['reason']:18} {reco['explanation']}")
PY
