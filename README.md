# Smart-Shop — Plateforme de vente en ligne distribuée

Projet d'examen de rattrapage — **Développement d'applications distribuées**.

Architecture distribuée composée de **deux microservices indépendants**, chacun
avec sa propre responsabilité, sa propre pile technologique et sa propre base de
données, communiquant entre eux sur un réseau overlay, déployés en **Docker
Swarm** en mode Stack et supervisés par **Portainer**.

> **État d'avancement : étape 2 / 15 — squelette des services.**
> Les sections marquées 🚧 seront complétées aux étapes indiquées.
> Voir [CLAUDE.md](CLAUDE.md) pour les règles permanentes du projet.

---

## 1. Les deux microservices

| | `service-catalogue-commandes` | `service-avis-recommandations` |
|---|---|---|
| **Responsabilité** | Catalogue produits (référence, prix, stock) et commandes clients | Avis clients, notes produits, historique, recommandations temps réel |
| **API** | **REST** | **GraphQL** |
| **Base de données** | **PostgreSQL 16** (intégrité transactionnelle) | **MongoDB 7** (flexibilité du schéma) |
| **Runtime** | Node.js 22 + TypeScript 5.7 | Node.js 22 + TypeScript 5.7 |
| **Framework** | Express 5 | Apollo Server 4 (sur Express) |
| **Accès données** | Prisma ORM | Mongoose ODM |
| **Port** | `3000` | `4000` |
| **Replicas Swarm** | **3** | **3** |

---

## 2. Architecture

```
                    ┌──────────────────────────────────────┐
                    │  Clients : curl / Postman / Apollo   │
                    │  Sandbox / navigateur / Portainer    │
                    └──┬──────────────┬─────────────────┬──┘
                 :3000 │        :4000 │           :9443 │
   ══════════════ overlay « smartshop-public » ══════════════
          ┌───────────▼──────┐  ┌────▼─────────────┐  ┌──▼──────────┐
          │  catalogue-api   │  │    avis-api      │  │  Portainer  │
          │   3 replicas     │◄─┤   3 replicas     │  │  CE + agent │
          │  REST / Express  ├─►│ GraphQL / Apollo │  │  (global)   │
          └───────────┬──────┘  └────┬─────────────┘  └──┬──────────┘
   ══════ overlay « smartshop-data » (internal: true) ════│══════════
                  ┌───▼────────┐        ┌────────▼───┐    │
                  │ PostgreSQL │        │  MongoDB   │  docker.sock
                  │ 1 replica  │        │ 1 replica  │  (manager)
                  └────────────┘        └────────────┘
```

### Flux de données inter-services

- **Flux 1 — `avis-api` → `catalogue-api` (REST).** Les champs `Product` des
  types GraphQL sont résolus via `GET /products/batch?refs=...`, avec batching
  **DataLoader** pour éviter le N+1.
- **Flux 2 — `catalogue-api` → `avis-api` (GraphQL).** `GET /products` enrichit
  chaque produit de sa note moyenne via `productRatings(refs: [...])`, avec
  **timeout 800 ms et fallback `rating: null`** : si `avis-api` tombe, le
  catalogue reste servi en mode dégradé.

---

## 3. Structure du dépôt

```
SmartShop/
├── CLAUDE.md                          Règles permanentes du projet
├── README.md                          Ce fichier
├── docker-stack.yml                   🚧 Placeholder (étape 11)
├── docker-compose.dev.yml             Vérification locale des images
├── scripts/verify-containers.sh       Contrôle automatisé de l'étape 10
├── .gitignore
│
├── service-catalogue-commandes/       REST + PostgreSQL + Prisma
│   ├── Dockerfile  .dockerignore  .env.example
│   ├── package.json  tsconfig.json  vitest.config.ts  eslint.config.js
│   ├── prisma/schema.prisma           🚧 Modèles à l'étape 3
│   ├── src/
│   │   ├── server.ts                  Bootstrap + arrêt propre (SIGTERM)
│   │   ├── app.ts                     Montage Express
│   │   ├── config/env.ts              Variables validées par zod
│   │   ├── db/prisma.ts               Client Prisma + retry exponentiel
│   │   ├── routes/                    health · products 🚧 · orders 🚧
│   │   ├── middleware/                requestId · errorHandler
│   │   ├── errors/                    Hiérarchie AppError
│   │   ├── lib/logger.ts              pino (JSON structuré)
│   │   └── controllers/ services/ repositories/ clients/   🚧 étapes 4-9
│   └── tests/{unit,integration}/
│
└── service-avis-recommandations/      GraphQL + MongoDB + Mongoose
    ├── Dockerfile  .dockerignore  .env.example
    ├── package.json  tsconfig.json  vitest.config.ts  eslint.config.js
    ├── src/
    │   ├── server.ts                  Bootstrap Apollo + arrêt propre
    │   ├── app.ts                     Express + middleware Apollo
    │   ├── config/env.ts              Variables validées par zod
    │   ├── db/mongoose.ts             Connexion Mongoose + retry exponentiel
    │   ├── schema/typeDefs.ts         🚧 Schéma complet aux étapes 7-8
    │   ├── resolvers/                 🚧 étapes 7-8
    │   ├── context.ts                 Contexte GraphQL
    │   ├── errors/  lib/logger.ts
    │   └── models/ services/ repositories/ clients/        🚧 étapes 6-9
    └── tests/{unit,integration}/
```

---

## 4. Prérequis

| Outil | Version minimale | Vérification |
|---|---|---|
| Node.js | 22 LTS | `node -v` |
| npm | 10+ | `npm -v` |
| Docker Engine | 24+ | `docker -v` |
| Docker Compose | v2 | `docker compose version` |

**Ports utilisés :** `3000` (REST), `4000` (GraphQL), `5432` (PostgreSQL),
`27017` (MongoDB), `9443` / `9000` (Portainer).
Vérifier qu'ils sont libres : `lsof -i :3000 -i :4000 -i :9443`

**Ressources Docker :** allouer au minimum **6 Go de RAM** — la stack complète
fait tourner 10 conteneurs (3 + 3 API, 2 bases, Portainer + agent).

---

## 5. Développement local

Chaque service est autonome. Depuis son dossier :

```bash
cd service-catalogue-commandes      # ou service-avis-recommandations

cp .env.example .env                # puis renseigner les valeurs locales
npm install

npm run dev                         # démarrage en watch (tsx)
npm run build                       # compilation TypeScript → dist/
npm start                           # exécution du build
npm test                            # suite de tests (vitest)
npm run lint                        # ESLint
npm run typecheck                   # vérification de types sans émission
```

> ⚠️ `.env` ne doit **jamais** être committé. Seul `.env.example` est versionné,
> avec des valeurs factices (`CHANGE_ME`).

### Points de terminaison disponibles dès maintenant

| Service | Route | Description |
|---|---|---|
| catalogue-api | `GET /health` | Liveness — le process répond |
| catalogue-api | `GET /ready` | Readiness — PostgreSQL joignable |
| avis-api | `GET /health` | Liveness |
| avis-api | `GET /ready` | Readiness — MongoDB joignable |
| avis-api | `POST /graphql` | Apollo Server (query `health` uniquement) |

Les routes `/products` et `/orders` ainsi que le schéma GraphQL complet
renvoient volontairement **`501 Not Implemented`** à ce stade.

---

## 6. Déploiement Docker Swarm

> Procédure complète, testée le 30/09/2026 sur un Swarm mono-nœud
> (Docker 29.8.1). Chaîne de démarrage :
> `postgres → catalogue-migrate → catalogue-api ×3`

### 6.1 Initialiser le Swarm

```bash
docker swarm init
docker node ls
```

### 6.2 Créer les secrets

Aucun mot de passe n'est versionné : le script en génère d'aléatoires et les
confie au Raft chiffré de Swarm.

```bash
./scripts/create-secrets.sh
docker secret ls
```

Quatre secrets sont créés : `pg_password`, `mongo_password`,
`catalogue_database_url`, `avis_mongodb_uri`.

### 6.3 Construire les trois images

```bash
docker build -t smartshop/catalogue-api:1.0.0                    ./service-catalogue-commandes
docker build -t smartshop/catalogue-migrate:1.0.0 --target migrator ./service-catalogue-commandes
docker build -t smartshop/avis-api:1.0.0                         ./service-avis-recommandations
docker images | grep smartshop
```

`catalogue-migrate` est bâtie sur la cible `migrator`, qui embarque le CLI
Prisma. L'image runtime `catalogue-api` ne le contient **pas** : c'est ce qui
la maintient à 368 Mo.

### 6.4 Valider avant de déployer

```bash
docker stack config -c docker-stack.yml        # doit sortir sans erreur
```

### 6.5 Déployer

```bash
docker stack deploy -c docker-stack.yml smart-shop
```

### 6.6 Vérifier

```bash
docker stack services smart-shop
docker stack ps smart-shop
```

Sortie attendue, après une quinzaine de secondes :

```
NAME                           MODE         REPLICAS   IMAGE
smart-shop_avis-api            replicated   3/3        smartshop/avis-api:1.0.0
smart-shop_catalogue-api       replicated   3/3        smartshop/catalogue-api:1.0.0
smart-shop_catalogue-migrate   replicated   0/1        smartshop/catalogue-migrate:1.0.0
smart-shop_mongodb             replicated   1/1        mongo:7
smart-shop_portainer           replicated   1/1        portainer/portainer-ce:2.21.4
smart-shop_portainer-agent     global       1/1        portainer/agent:2.21.4
smart-shop_postgres            replicated   1/1        postgres:16-alpine
```

> `catalogue-migrate` affiche **0/1** : c'est normal. C'est un travail
> ponctuel avec `restart_policy: condition: none` — il applique les
> migrations, sort en 0, et Swarm ne le relance pas.

### 6.7 Vérifier la migration

```bash
docker service logs smart-shop_catalogue-migrate
```

Au premier déploiement :

```
1 migration found in prisma/migrations
Applying migration `20260930120000_init`
All migrations have been successfully applied.
migrate: terminé avec succès (tentative 1)
```

Aux suivants — la commande est idempotente :

```
No pending migrations to apply.
migrate: terminé avec succès (tentative 1)
```

Swarm n'ordonnance pas les démarrages : le service réessaie
`prisma migrate deploy` jusqu'à 30 fois, toutes les 2 secondes, jusqu'à ce que
PostgreSQL réponde.

### 6.8 Vérifier les API

```bash
# Santé — /ready contrôle désormais la présence du schéma, pas seulement
# la joignabilité de la base.
curl -s http://localhost:3000/health
curl -s http://localhost:3000/ready    # {"checks":{"postgresql":"up","schema":"ready"}}
curl -s http://localhost:4000/health
curl -s http://localhost:4000/ready

# REST — catalogue et commandes
curl -s -X POST http://localhost:3000/products \
  -H 'content-type: application/json' \
  -d '{"reference":"SS-PRD-00001","name":"Casque audio","price":"129.90","stock":10}'

curl -s 'http://localhost:3000/products?limit=5'

# Remplacer <id> par l'identifiant renvoyé ci-dessus
curl -s -X POST http://localhost:3000/orders \
  -H 'content-type: application/json' \
  -d '{"customerName":"Amina Diallo","items":[{"productId":"<id>","quantity":3}]}'

curl -s -X DELETE http://localhost:3000/orders/<id-commande>   # restitue le stock

# GraphQL — avis et recommandations
curl -s -X POST http://localhost:4000/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"mutation{createReview(input:{userId:\"u1\",productId:\"p1\",rating:5,comment:\"Excellent.\"}){id rating}}"}'

curl -s -X POST http://localhost:4000/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{recommendations(userId:\"u1\"){productId score reason explanation}}"}'
```

Si `/ready` renvoie `{"schema":"pending"}`, la base répond mais les migrations
n'ont pas encore été appliquées — consulter les logs de `catalogue-migrate`.

### 6.9 Portainer

| | |
|---|---|
| URL | `https://localhost:9443` (ou `http://localhost:9000`) |
| Premier accès | créer le compte administrateur |
| Environnement | choisir **Docker Swarm** (l'agent est déjà déployé) |

Le certificat est auto-signé : le navigateur affiche un avertissement, à
accepter. L'agent tourne en `mode: global` — une tâche par nœud — ce qui donne
la vue sur tous les services, tous les nœuds et les logs en temps réel.

### 6.10 Vérifier les 3 replicas

```bash
docker service ls --filter name=smart-shop_catalogue-api
docker service ps smart-shop_catalogue-api     # 3 tâches Running
docker service ps smart-shop_avis-api          # 3 tâches Running
```

Contrôler la stratégie de mise à jour réellement appliquée :

```bash
docker service inspect smart-shop_catalogue-api \
  --format 'parallelism={{.Spec.UpdateConfig.Parallelism}} delay={{.Spec.UpdateConfig.Delay}}'
```

---

## 7. Test de résilience — tuer un conteneur

Exigé par le sujet : prouver que l'application reste disponible après la
suppression manuelle d'un conteneur.

```bash
# 1. Lancer une sonde continue dans un terminal
while true; do
  printf '%s %s\n' "$(date +%T)" "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/health)"
  sleep 1
done

# 2. Dans un second terminal, tuer un replica
docker ps --filter name=smart-shop_catalogue-api --format '{{.ID}} {{.Names}}'
docker rm -f <ID_DU_CONTENEUR>

# 3. Observer Swarm recréer la tâche
watch -n 1 docker service ls --filter name=smart-shop_catalogue-api
docker service ps smart-shop_catalogue-api
```

**Résultat mesuré le 30/09/2026** : 40 requêtes pendant l'incident,
**40 succès, 0 échec — 100 % de disponibilité**. Le replica a été recréé et le
service est revenu à `3/3` en **11 secondes**.

Les deux autres replicas continuent de servir pendant la recréation : c'est le
routing mesh de Swarm qui écarte automatiquement la tâche morte.

---

## 8. Rolling update — observer `parallelism: 1` et `delay: 10s`

```bash
docker service update --force smart-shop_catalogue-api
watch -n 1 docker service ps smart-shop_catalogue-api
```

Les replicas sont remplacés **un par un**, avec **10 secondes** entre chacun.
`order: start-first` fait démarrer le nouveau conteneur avant d'arrêter
l'ancien : aucune coupure de service.

---

## 9. Arrêt et nettoyage

```bash
docker stack rm smart-shop

# Les volumes survivent au retrait de la stack. Pour repartir à zéro :
docker volume rm smart-shop_pgdata smart-shop_mongodata smart-shop_portainer_data

# Supprimer les secrets (immuables : il faut les recréer pour les changer)
docker secret rm pg_password mongo_password catalogue_database_url avis_mongodb_uri

# Quitter le Swarm
docker swarm leave --force
```

---

## 10. Dépannage

| Symptôme | Cause probable | Correction |
|---|---|---|
| API bloquée en `0/3` | Image absente ou variable manquante | `docker service ps <svc> --no-trunc` puis `docker service logs <svc>` |
| `/ready` → `{"schema":"pending"}` | Migrations non appliquées | `docker service logs smart-shop_catalogue-migrate` |
| `catalogue-migrate` en `0/1` | **Normal** : travail ponctuel terminé | Vérifier `Complete` dans `docker service ps` |
| `port already in use` | Un service natif occupe le port | `lsof -nP -iTCP:5432 -sTCP:LISTEN` ; un PostgreSQL hôte est fréquent |
| Tâches en `Rejected` | Image introuvable par le nœud | En multi-nœuds, un registre local est nécessaire |
| Secret modifié sans effet | Les secrets Swarm sont **immuables** | `docker stack rm`, `docker secret rm`, recréer, redéployer |

---

## 11. 🚧 Justification SQL vs NoSQL — *étape 15*

---

## Licence

Projet académique — usage pédagogique.
