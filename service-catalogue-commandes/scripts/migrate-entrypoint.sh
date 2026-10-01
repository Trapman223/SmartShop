#!/bin/sh
# =============================================================================
#  Smart-Shop — application des migrations Prisma (service éphémère)
# =============================================================================
#  Docker Swarm ne garantit aucun ordre de démarrage : `depends_on` y est
#  ignoré. Ce script ne suppose donc pas que PostgreSQL est prêt — il réessaie
#  jusqu'à ce qu'il le soit.
#
#  `prisma migrate deploy` est nativement idempotent : il consulte la table
#  _prisma_migrations et n'applique que ce qui manque. Le rejouer sur une base
#  déjà à jour affiche « No pending migrations » et sort en 0. On peut donc
#  l'utiliser à la fois comme test de disponibilité et comme migration : une
#  seule mécanique, pas de sonde séparée à maintenir.
# =============================================================================
set -eu

MAX_RETRIES="${MIGRATE_MAX_RETRIES:-30}"
RETRY_DELAY="${MIGRATE_RETRY_DELAY:-2}"

# Secret Docker Swarm : monté en fichier, jamais en variable d'environnement.
# `$(cat ...)` supprime au passage le saut de ligne final, qui rendrait l'URL
# de connexion invalide.
if [ -z "${DATABASE_URL:-}" ] && [ -n "${DATABASE_URL_FILE:-}" ]; then
  if [ ! -r "$DATABASE_URL_FILE" ]; then
    echo "migrate: secret illisible : $DATABASE_URL_FILE" >&2
    exit 1
  fi
  DATABASE_URL="$(cat "$DATABASE_URL_FILE")"
  export DATABASE_URL
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "migrate: ni DATABASE_URL ni DATABASE_URL_FILE n'est défini" >&2
  exit 1
fi

echo "migrate: attente de PostgreSQL et application des migrations"
echo "migrate: $MAX_RETRIES tentatives maximum, ${RETRY_DELAY}s entre chacune"

attempt=1
while [ "$attempt" -le "$MAX_RETRIES" ]; do
  # `set -e` ne doit pas interrompre la boucle sur un échec attendu.
  if npx prisma migrate deploy; then
    echo "migrate: terminé avec succès (tentative $attempt)"
    exit 0
  fi

  echo "migrate: tentative $attempt/$MAX_RETRIES échouée (PostgreSQL pas encore prêt ?), nouvelle tentative dans ${RETRY_DELAY}s"
  attempt=$((attempt + 1))
  sleep "$RETRY_DELAY"
done

echo "migrate: abandon après $MAX_RETRIES tentatives" >&2
exit 1
