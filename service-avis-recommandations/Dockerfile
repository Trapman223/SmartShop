# =============================================================================
#  Smart-Shop — service-avis-recommandations (GraphQL + MongoDB + Mongoose)
#  Build multi-stage — cf. CLAUDE.md section 9 « Règles Docker »
# =============================================================================

# ----------------------------------------------------------------------------
#  Stage 1 — builder : dépendances complètes et compilation TypeScript
# ----------------------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# package*.json copiés d'abord : la couche npm ci reste en cache tant que
# les dépendances ne changent pas (cf. CLAUDE.md section 9, règle 3).
COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ----------------------------------------------------------------------------
#  Stage 2 — deps : dépendances de production uniquement
# ----------------------------------------------------------------------------
FROM node:22-alpine AS deps

WORKDIR /app

# ⚠️ NE PAS ajouter --omit=peer ici.
# Testé et rejeté : npm retire alors `graphql`, bien qu'il soit une
# dépendance DIRECTE, parce que le lockfile le marque aussi comme peer de
# @apollo/server. Le conteneur démarre puis meurt sur
# « Cannot find package 'graphql' ». Le gain mesuré était de 3 Mo.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ----------------------------------------------------------------------------
#  Stage 3 — runner : image finale minimale
# ----------------------------------------------------------------------------
FROM node:22-alpine AS runner

LABEL org.opencontainers.image.title="smartshop-avis-api" \
      org.opencontainers.image.description="Smart-Shop — API GraphQL Avis & Recommandations" \
      org.opencontainers.image.version="1.1.0"

# tini : PID 1. Pas de curl : busybox fournit déjà wget pour le HEALTHCHECK.
RUN apk add --no-cache tini

ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps    --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist         ./dist
COPY --chown=node:node package.json ./

# Jamais root (cf. CLAUDE.md section 8, règle 3).
USER node

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:4000/health || exit 1

# tini comme PID 1 : garantit que SIGTERM atteint le process Node lors des
# rolling updates Swarm (cf. CLAUDE.md section 9, règle 7).
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
