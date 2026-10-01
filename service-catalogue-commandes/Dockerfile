# =============================================================================
#  Smart-Shop — service-catalogue-commandes (API REST + PostgreSQL + Prisma)
#  Build multi-stage — cf. CLAUDE.md section 9 « Règles Docker »
# =============================================================================

# ----------------------------------------------------------------------------
#  Stage 1 — builder : dépendances complètes, génération Prisma, compilation TS
# ----------------------------------------------------------------------------
FROM node:22-alpine AS builder

# openssl est requis par le query engine Prisma sur Alpine (musl).
RUN apk add --no-cache openssl

WORKDIR /app

# package*.json copiés d'abord : la couche npm ci reste en cache tant que
# les dépendances ne changent pas (cf. CLAUDE.md section 9, règle 3).
COPY package*.json ./
RUN npm ci

# Génération Prisma AVANT la copie des sources : le téléchargement et la
# compilation du query engine restent ainsi en cache quand seul src/ change.
COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ----------------------------------------------------------------------------
#  Stage 2 — migrator : application des migrations Prisma
# ----------------------------------------------------------------------------
#  Hérite du builder, qui possède déjà le CLI Prisma (devDependency), le
#  schéma et le dossier prisma/migrations. C'est ce qui permet de garder
#  l'image runtime légère : le CLI n'y entre jamais.
#
#  Image éphémère : elle applique les migrations puis sort. Elle n'expose
#  aucun port, ne sert aucune requête, et n'a donc pas de HEALTHCHECK.
# ----------------------------------------------------------------------------
FROM builder AS migrator

LABEL org.opencontainers.image.title="smartshop-catalogue-migrate" \
      org.opencontainers.image.description="Smart-Shop — migrations Prisma (job éphémère)" \
      org.opencontainers.image.version="1.0.0"

ENV NODE_ENV=production

COPY scripts/migrate-entrypoint.sh /usr/local/bin/migrate-entrypoint.sh
RUN chmod +x /usr/local/bin/migrate-entrypoint.sh \
 && chown -R node:node /app

# Jamais root, même pour un job court (cf. CLAUDE.md section 8, règle 3).
USER node

ENTRYPOINT ["/usr/local/bin/migrate-entrypoint.sh"]

# ----------------------------------------------------------------------------
#  Stage 3 — deps : dépendances de production uniquement
# ----------------------------------------------------------------------------
FROM node:22-alpine AS deps

RUN apk add --no-cache openssl
WORKDIR /app

# --omit=peer est indispensable ici : @prisma/client déclare `prisma` (50 Mo)
# et `typescript` (23 Mo) en peerDependencies OPTIONNELLES, et npm les
# installe malgré --omit=dev. Sans ce drapeau, le CLI Prisma et le compilateur
# TypeScript se retrouvent dans l'image de production.
COPY package*.json ./
RUN npm ci --omit=dev --omit=peer && npm cache clean --force

# ---------------------------------------------------------------------------
#  Élagage des moteurs inutiles — mesuré, pas supposé.
# ---------------------------------------------------------------------------
#  ⚠️ L'élagage DOIT se faire ici, dans le stage deps. Les couches Docker sont
#     additives : supprimer des fichiers après le COPY du runner laisserait la
#     couche d'origine intacte et n'allégerait rien. `COPY --from=deps` copie
#     l'état final du système de fichiers de ce stage, donc déjà élagué.
#
#  @prisma/engines (35,6 Mo) contient le schema-engine, utilisé uniquement par
#  le CLI pour les migrations, et un DOUBLON du query engine déjà présent dans
#  .prisma/client. L'application ne s'en sert jamais.
#
#  @prisma/client/runtime embarque les moteurs WebAssembly de CockroachDB,
#  MySQL, SQL Server et SQLite. Ce service parle exclusivement à PostgreSQL,
#  et via le moteur natif (.so.node), pas via WebAssembly.
#
#  Les migrations restent applicables : elles passent par un conteneur bâti sur
#  le stage `builder`, qui dispose du CLI complet (cf. docker-compose.dev.yml).
# ---------------------------------------------------------------------------
RUN rm -rf node_modules/@prisma/engines node_modules/@prisma/fetch-engine \
 && find node_modules/@prisma/client/runtime -name '*.map' -delete \
 && find node_modules/@prisma/client/runtime \
      \( -name '*_bg.mysql.*' -o -name '*_bg.sqlite.*' \
      -o -name '*_bg.sqlserver.*' -o -name '*_bg.cockroachdb.*' \) -delete

# ----------------------------------------------------------------------------
#  Stage 4 — runner : image finale minimale (SANS le CLI Prisma)
# ----------------------------------------------------------------------------
FROM node:22-alpine AS runner

LABEL org.opencontainers.image.title="smartshop-catalogue-api" \
      org.opencontainers.image.description="Smart-Shop — API REST Catalogue & Commandes" \
      org.opencontainers.image.version="1.0.0"

# openssl : runtime du query engine Prisma. tini : PID 1.
# Pas de curl : busybox fournit déjà wget, utilisé par le HEALTHCHECK.
RUN apk add --no-cache openssl tini

ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps    --chown=node:node /app/node_modules          ./node_modules
# Client Prisma généré : produit dans le builder (seul stage disposant du CLI
# prisma, devDependency), injecté par-dessus les node_modules de production.
# Contient aussi libquery_engine-linux-musl-openssl-3.0.x.so.node.
COPY --from=builder --chown=node:node /app/node_modules/.prisma  ./node_modules/.prisma
COPY --from=builder --chown=node:node /app/dist                  ./dist

# Seuls le schéma et les migrations entrent dans l'image : ils servent à
# `prisma migrate deploy`. prisma/seed.ts est du code de développement et
# n'a rien à faire en production (cf. CLAUDE.md section 9, règle 12).
COPY --chown=node:node prisma/schema.prisma ./prisma/schema.prisma
COPY --chown=node:node prisma/migrations    ./prisma/migrations
COPY --chown=node:node package.json         ./

# Jamais root (cf. CLAUDE.md section 8, règle 3).
USER node

EXPOSE 3000

# wget est fourni par busybox : aucun paquet supplémentaire dans l'image.
# start-period généreux : Prisma initialise son query engine au démarrage.
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/health || exit 1

# tini comme PID 1 : garantit que SIGTERM atteint le process Node lors des
# rolling updates Swarm (cf. CLAUDE.md section 9, règle 7).
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
