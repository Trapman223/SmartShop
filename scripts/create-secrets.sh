#!/usr/bin/env bash
# =============================================================================
#  Smart-Shop — création des secrets Docker Swarm
# =============================================================================
#  Aucun mot de passe n'est écrit dans le dépôt : ils sont générés ici,
#  stockés chiffrés dans le Raft de Swarm, et montés en fichiers dans les
#  conteneurs sous /run/secrets/.
#
#  Usage :  ./scripts/create-secrets.sh
#  Les mots de passe peuvent être imposés :
#           PG_PASSWORD=... MONGO_PASSWORD=... ./scripts/create-secrets.sh
# =============================================================================
set -euo pipefail

if ! docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null | grep -q active; then
  echo "Swarm inactif. Lancer d'abord :  docker swarm init" >&2
  exit 1
fi

# Mots de passe aléatoires par défaut : rien à choisir, rien à retenir,
# rien à committer par inadvertance.
PG_PASSWORD="${PG_PASSWORD:-$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)}"
MONGO_PASSWORD="${MONGO_PASSWORD:-$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)}"

PG_USER=smartshop
PG_DB=smartshop_catalogue
MONGO_USER=smartshop
MONGO_DB=smartshop_avis

# Les noms d'hôtes sont les NOMS DE SERVICE Swarm, résolus par le DNS interne.
DATABASE_URL="postgresql://${PG_USER}:${PG_PASSWORD}@postgres:5432/${PG_DB}?schema=public&connection_limit=5"
MONGODB_URI="mongodb://${MONGO_USER}:${MONGO_PASSWORD}@mongodb:27017/${MONGO_DB}?authSource=admin"

creer() {
  local nom="$1" valeur="$2"
  if docker secret inspect "$nom" > /dev/null 2>&1; then
    echo "  = $nom existe déjà (inchangé)"
  else
    # printf '%s' sans saut de ligne final : un \n corromprait l'URL.
    printf '%s' "$valeur" | docker secret create "$nom" - > /dev/null
    echo "  + $nom créé"
  fi
}

echo "Création des secrets Swarm :"
creer pg_password             "$PG_PASSWORD"
creer mongo_password          "$MONGO_PASSWORD"
creer catalogue_database_url  "$DATABASE_URL"
creer avis_mongodb_uri        "$MONGODB_URI"

echo
echo "Secrets en place :"
docker secret ls --format '  {{.Name}}  (créé {{.CreatedAt}})'
echo
echo "Déploiement :  docker stack deploy -c docker-stack.yml smartshop"
echo
echo "Note : pour changer un mot de passe, Swarm impose de supprimer puis"
echo "recréer le secret, les secrets étant immuables :"
echo "  docker stack rm smartshop && docker secret rm pg_password catalogue_database_url"
