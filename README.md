# Smart-Shop

Plateforme e-commerce distribuée — projet d'examen de rattrapage,
**Développement d'applications distribuées**.

---

## Présentation

Smart-Shop est composé de **deux microservices indépendants**, chacun avec sa
propre responsabilité, sa propre pile technologique et sa propre base de
données. Ils communiquent entre eux sur un réseau overlay, sont déployés en
**Docker Swarm** en mode Stack, et supervisés par **Portainer**.

| | Service 1 | Service 2 |
|---|---|---|
| Nom | `service-catalogue-commandes` | `service-avis-recommandations` |
| Rôle | Catalogue produits et commandes clients | Avis, notes, historique, recommandations |
| API | **REST** (port 3000) | **GraphQL** (port 4000) |
| Base | **PostgreSQL 16** | **MongoDB 7** |
| Replicas | **3** | **3** |

Le découpage n'est pas arbitraire. Les commandes exigent des **transactions
ACID** : vendre le dernier article à un seul client, même sous trois replicas
concurrents. Les avis exigent de la **souplesse de schéma** : texte libre,
tags variables, métadonnées hétérogènes. Ce sont deux besoins contradictoires,
et c'est exactement pourquoi chaque service a sa propre base.

---

## Architecture

```
                   ┌─────────────────────────────────────────┐
                   │ curl · Postman · Apollo Sandbox · navigateur │
                   └──┬──────────────┬──────────────────┬─────┘
                :3000 │        :4000 │            :9443 │
  ═══════════ overlay « smartshop-public » ═══════════════════
        ┌───────────▼──────┐  ┌────▼─────────────┐  ┌──▼──────────┐
        │  catalogue-api   │  │    avis-api      │  │  Portainer  │
        │   3 replicas     │◄─┤   3 replicas     │  │  CE + agent │
        │  REST / Express  ├─►│ GraphQL / Apollo │  │  (global)   │
        └───────────┬──────┘  └────┬─────────────┘  └──┬──────────┘
                    │              │                   │
  ═ overlay « smartshop-pg » ═╗    ╚═ overlay « smartshop-mongo » ═╗
       (internal: true)       ║         (internal: true)           ║
            ┌─────────────────▼┐              ┌───────────────────▼┐
            │   PostgreSQL 16  │              │     MongoDB 7      │  docker.sock
            │    1 replica     │              │     1 replica      │  (manager)
            │  volume pgdata   │              │ volume mongodata   │
            └──────────────────┘              └────────────────────┘
```

### Les deux flux inter-services

Le sujet impose que les services **communiquent entre eux**. Deux flux
bidirectionnels, adressés par **nom DNS Swarm** — jamais par `localhost` ni
par IP :

**Flux 1 — `avis-api` → `catalogue-api` (REST)**
Le champ `product` des types GraphQL est résolu en appelant
`GET http://catalogue-api:3000/products/batch?refs=…`.
Les appels sont regroupés par un **DataLoader** : une requête GraphQL portant
sur 50 avis déclenche **un seul** appel HTTP, pas 50.

**Flux 2 — `catalogue-api` → `avis-api` (GraphQL)**
`GET /products` enrichit chaque produit de sa note moyenne via
`productRatings(productIds: […])`.
**Timeout 800 ms et repli sur `rating: null`** : si `avis-api` est
indisponible, le catalogue continue de répondre en mode dégradé plutôt que de
tomber avec lui.

### Isolation des bases

PostgreSQL et MongoDB vivent sur **deux réseaux overlay distincts**, tous deux
déclarés `internal: true`. Conséquence concrète : `avis-api` ne peut pas même
*atteindre* PostgreSQL — l'isolation est topologique, pas seulement
conventionnelle. Aucune des deux bases n'expose de port vers l'hôte.

---

## Technologies

| Couche | Service Catalogue | Service Avis |
|---|---|---|
| Runtime | Node.js 22 (alpine) | Node.js 22 (alpine) |
| Langage | TypeScript 5.7, `strict` | TypeScript 5.7, `strict` |
| Framework | Express 5.0.1 | Apollo Server 4.11.3 sur Express 4.21.2 |
| Accès données | Prisma 6.2.1 | Mongoose 8.9.5 |
| Base | PostgreSQL 16 | MongoDB 7 |
| Validation | zod 3.24.1 | zod 3.24.1 |
| Journalisation | pino 9.6.0 (JSON) | pino 9.6.0 (JSON) |
| Tests | Vitest + supertest | Vitest + `executeOperation` |
| Anti N+1 | — | DataLoader 2.2.3 |

Orchestration : **Docker Swarm**. Supervision : **Portainer CE 2.21.4**.

---

## Structure du repository

```
SmartShop/
├── docker-stack.yml                    ← fichier de déploiement Swarm
├── docker-compose.dev.yml              ← développement local uniquement
├── README.md
├── CLAUDE.md                           ← charte technique du projet
│
├── service-catalogue-commandes/
│   ├── Dockerfile                      ← 4 stages : builder, migrator, deps, runner
│   ├── .dockerignore
│   ├── prisma/
│   │   ├── schema.prisma               Product, Order, OrderItem, OrderStatus
│   │   ├── migrations/                 dont les contraintes CHECK manuelles
│   │   └── seed.ts                     12 produits de démonstration
│   ├── scripts/migrate-entrypoint.sh   attente de PostgreSQL + migrate deploy
│   ├── src/
│   │   ├── server.ts  app.ts
│   │   ├── config/      env.ts · openapi.ts · secrets.ts
│   │   ├── db/          prisma.ts
│   │   ├── routes/      health · docs · products · orders
│   │   ├── controllers/ services/ repositories/
│   │   ├── validators/  utils/  errors/  middlewares/  clients/
│   └── tests/{unit,helpers}/
│
├── service-avis-recommandations/
│   ├── Dockerfile                      ← 3 stages : builder, deps, runner
│   ├── .dockerignore
│   ├── src/
│   │   ├── server.ts  app.ts  context.ts
│   │   ├── graphql/     typeDefs.ts · scalars.ts · jsonScalar.ts · limits.ts
│   │   ├── models/      Review.model.ts · BrowsingEvent.model.ts
│   │   ├── resolvers/ services/ repositories/ clients/
│   │   ├── validators/  utils/  errors/  middlewares/  db/
│   └── tests/{unit,helpers}/
│
├── scripts/
│   ├── create-secrets.sh               génère les 4 secrets Swarm
│   ├── smoke-test.sh                   parcours fonctionnel complet
│   ├── concurrency-test.sh             intégrité du stock sous concurrence
│   ├── chaos-test.sh                   résilience après suppression d'un conteneur
│   ├── verify-containers.sh            contrôle des images
│   └── build-compte-rendu.py           génération du compte-rendu
│
└── docs/compte-rendu/                  compte-rendu + journaux horodatés
```

---

## Service Catalogue & Commandes

API REST gérant le catalogue produits et les commandes.

**Invariant métier :** le stock ne peut jamais devenir négatif, même sous
trois replicas concurrents.

Cet invariant est tenu à **trois niveaux** :

1. **Verrou pessimiste.** `POST /orders` ouvre une transaction et verrouille
   les lignes produits concernées avec `SELECT … FOR UPDATE`, émis via
   `prisma.$queryRaw` — Prisma n'expose pas cette clause dans son API fluide.
   Le `ORDER BY id` évite les interblocages entre deux commandes portant sur
   les mêmes produits dans un ordre différent.
2. **Contraintes `CHECK` en base.** `stock >= 0`, `price >= 0`,
   `quantity > 0`, ajoutées par migration SQL manuelle. C'est le filet de
   sécurité au niveau du moteur : même un bug applicatif ne peut pas écrire un
   stock négatif.
3. **Fusion des lignes dupliquées.** Deux lignes du même produit dans une
   commande sont additionnées *avant* le contrôle de stock. Sans cela,
   `[{p,3},{p,4}]` sur un stock de 5 passerait ligne par ligne.

**Architecture en couches**, dépendances à sens unique :
`routes → controllers → services → repositories → db`.
Un repository ne connaît ni Express ni GraphQL ; un service ne manipule jamais
`req`/`res`.

---

## Service Avis & Recommandations

API GraphQL gérant les avis, les notes produits, l'historique de navigation et
les recommandations.

**Les recommandations sont déterministes et explicables** — aucun
apprentissage, aucun aléa. Le score combine trois signaux normalisés :

```
score = 0,5 × note moyenne pondérée par la fiabilité
      + 0,3 × affinité avec les catégories consultées
      + 0,2 × co-consultation (clients aux parcours semblables)
```

Les pondérations sont configurables par variables d'environnement. Chaque
recommandation porte un champ `reason` et une `explanation` en français :
« Noté 4.6/5 par 32 client(s) ».

Deux détails qui comptent. La note est **pondérée par la fiabilité** : 5/5 sur
un seul avis passe derrière 4,5/5 sur cent. Le tri est **déterministe à trois
niveaux** (score, puis note, puis identifiant) — sans ce dernier critère, deux
exécutions sur les mêmes données pourraient diverger.

Un client sans historique reçoit quand même des recommandations : les signaux
personnels valent 0 et le classement se réduit aux produits les mieux notés.

---

## REST API

Base : `http://localhost:3000`

| Méthode | Route | Description | Codes |
|---|---|---|---|
| `GET` | `/health` | Liveness — le process répond | 200 |
| `GET` | `/ready` | Readiness — PostgreSQL joignable **et schéma présent** | 200 · 503 |
| `GET` | `/products` | Catalogue paginé | 200 · 400 |
| `GET` | `/products/batch` | Résolution par lot (flux 1) | 200 · 400 |
| `GET` | `/products/:id` | Détail produit | 200 · 400 · 404 |
| `POST` | `/products` | Création | 201 · 400 · 409 |
| `PUT` | `/products/:id` | Remplacement complet | 200 · 400 · 404 · 409 |
| `DELETE` | `/products/:id` | Suppression | 204 · 404 · 409 |
| `GET` | `/orders` | Commandes paginées | 200 · 400 |
| `GET` | `/orders/:id` | Détail commande | 200 · 400 · 404 |
| `POST` | `/orders` | **Création transactionnelle** | 201 · 400 · 404 · 409 |
| `PATCH` | `/orders/:id/status` | Transition de statut | 200 · 400 · 404 · 409 |
| `DELETE` | `/orders/:id` | Annulation + restitution du stock | 204 · 400 · 404 · 409 |
| `GET` | `/docs` | Swagger UI | 200 |
| `GET` | `/openapi.json` | Spécification OpenAPI 3.1 | 200 |

Paramètres de `GET /products` : `page`, `limit` (max 100), `q`, `minPrice`,
`maxPrice`, `inStock`, `sort` (`price:asc`, `name:desc`, `createdAt:desc`…).

**Format d'erreur — RFC 7807**, avec un `traceId` permettant de retrouver la
requête dans les logs, quel que soit le replica qui l'a traitée :

```json
{
  "type": "https://smartshop/errors/insufficient_stock",
  "title": "Stock insuffisant",
  "status": 409,
  "instance": "/orders",
  "traceId": "36241480-43dd-4e9f-9ec5-81c808d202ef",
  "detail": "SS-PRD-00001 : 2 disponible(s), 50 demandé(s)"
}
```

**Les montants sont transportés en chaîne** (`"price": "129.90"`), jamais en
nombre : un flottant IEEE-754 ne représente pas exactement 0,1 + 0,2 et
fausserait les totaux.

### Exemples

```bash
# Créer un produit
curl -s -X POST http://localhost:3000/products \
  -H 'content-type: application/json' \
  -d '{"reference":"SS-PRD-00001","name":"Casque audio","price":"129.90","stock":10}'

# Lister le catalogue
curl -s 'http://localhost:3000/products?limit=5&sort=price:asc'

# Commander (remplacer <id> par l'identifiant renvoyé à la création)
curl -s -X POST http://localhost:3000/orders \
  -H 'content-type: application/json' \
  -d '{"customerName":"Amina Diallo","items":[{"productId":"<id>","quantity":2}]}'

# Annuler — le stock est restitué dans la même transaction
curl -s -X DELETE http://localhost:3000/orders/<id-commande>
```

---

## GraphQL API

Point de terminaison : `http://localhost:4000/graphql`
Exploration : ouvrir cette URL dans un navigateur (Apollo Sandbox).

### Queries

| Query | Description |
|---|---|
| `productsReviews(productId, limit, offset, sort, minRating, tags)` | Avis d'un produit |
| `userReviews(userId, limit, offset, sort, minRating, tags)` | Historique des avis d'un client |
| `review(id)` | Un avis par identifiant |
| `recommendations(userId, limit)` | Recommandations personnalisées |
| `productRating(productId)` | Note agrégée d'un produit |
| `productRatings(productIds)` | Notes de plusieurs produits (flux 2) |
| `browsingHistory(userId, limit)` | Historique de navigation |
| `health` | Sonde de santé |

### Mutations

| Mutation | Description |
|---|---|
| `createReview(input)` | Poster un avis |
| `updateReview(id, input)` | Modifier un avis |
| `deleteReview(id)` | Supprimer un avis |
| `trackBrowsingEvent(input)` | Enregistrer une consultation |

### Validation et garde-fous

- **`rating` : entier strictement compris entre 1 et 5.** Validé deux fois —
  par zod avant écriture, puis par le schéma Mongoose. La seconde couche
  protège même en cas d'écriture directe en base.
- **Un seul avis par client et par produit**, garanti par un index unique
  `(userId, productId)`. Un doublon renvoie `CONFLICT` (409).
- **Tags normalisés** : minuscules et dédoublonnés, 10 maximum.
- **`GRAPHQL_MAX_ROOT_FIELDS` (20)** borne l'amplification par alias.
- **`GRAPHQL_MAX_DEPTH` (8)** borne l'imbrication.
- **L'introspection reste active** et exemptée de ces deux règles, pour
  permettre l'exploration du schéma depuis Apollo Sandbox.

Les erreurs portent un code exploitable : `BAD_USER_INPUT`, `NOT_FOUND`,
`CONFLICT`, `SERVICE_UNAVAILABLE`, `GRAPHQL_VALIDATION_FAILED`.

### Exemples

```bash
# Poster un avis
curl -s -X POST http://localhost:4000/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"mutation{createReview(input:{userId:\"u-001\",productId:\"SS-PRD-00001\",rating:5,comment:\"Excellent.\",tags:[\"qualite\"]}){id rating tags}}"}'

# Note agrégée d'un produit
curl -s -X POST http://localhost:4000/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{productRating(productId:\"SS-PRD-00001\"){average count distribution{one five}}}"}'

# Recommandations expliquées
curl -s -X POST http://localhost:4000/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{recommendations(userId:\"u-001\"){productId score reason explanation}}"}'
```

---

## PostgreSQL

Trois tables et un type énuméré, gérés par Prisma.

```
products                              orders
  id            UUID PK                 id            UUID PK
  reference     VARCHAR(32) UNIQUE      customer_name VARCHAR(200)
  name          VARCHAR(200)            status        OrderStatus
  description   TEXT NULL               total         NUMERIC(12,2)
  price         NUMERIC(10,2)           created_at / updated_at
  stock         INTEGER
  created_at / updated_at             order_items
                                        id            UUID PK
OrderStatus                             order_id      → orders    ON DELETE CASCADE
  PENDING · CONFIRMED                   product_id    → products  ON DELETE RESTRICT
  SHIPPED · CANCELLED                   quantity      INTEGER
                                        unit_price    NUMERIC(10,2)
                                        UNIQUE (order_id, product_id)
```

**Contraintes `CHECK` ajoutées par migration manuelle** — Prisma ne sait pas
les exprimer : `stock >= 0`, `price >= 0`, `total >= 0`, `quantity > 0`,
`unit_price >= 0`.

Deux choix de modélisation à souligner. `unit_price` **fige le prix au moment
de la commande** : une évolution tarifaire ne doit pas réécrire l'historique.
Et les relations sont asymétriques — `CASCADE` sur la commande (supprimer une
commande supprime ses lignes), `RESTRICT` sur le produit (un produit commandé
ne peut pas disparaître).

Les migrations sont appliquées par un **service Swarm dédié et éphémère**, pas
par l'API. Voir la section Docker Swarm.

---

## MongoDB

Deux collections, gérées par Mongoose.

```
reviews                               browsing_events
  _id                                   _id
  userId                                userId
  productId                             productId
  rating        1..5, entier             category
  comment       texte libre              eventType  VIEW · SEARCH
  tags          [String], ≤ 10                      ADD_TO_CART · PURCHASE
  createdAt / updatedAt                  metadata   Mixed — libre
                                         createdAt
```

**Index**

| Collection | Index | Rôle |
|---|---|---|
| `reviews` | `(userId, productId)` **unique** | Un seul avis par client et par produit |
| `reviews` | `(productId, createdAt ↓)` | Avis d'un produit, du plus récent |
| `reviews` | `(userId, createdAt ↓)` | Historique d'un client |
| `reviews` | `tags` | Filtrage par tag |
| `browsing_events` | `(userId, createdAt ↓)` | Historique de navigation |
| `browsing_events` | `createdAt` **TTL 90 j** | Purge automatique par MongoDB |

Le champ **`metadata` est de type `Mixed`, sans schéma imposé** : un événement
`SEARCH` y range un terme de recherche, un `PURCHASE` une quantité — sans
migration ni colonne supplémentaire. C'est la démonstration concrète de
l'argument NoSQL, et il est exposé dans l'API via un scalaire `JSON`.

Les index sont créés **explicitement au démarrage** par `ensureIndexes()`.
`autoIndex` est désactivé : sinon chacun des replicas retenterait leur création
à chaque usage de modèle.

---

## Docker

Chaque service a son propre Dockerfile **multi-stage**.

| Image | Taille | Rôle |
|---|---|---|
| `smartshop/catalogue-api:1.1.0` | **322 Mo** | API REST |
| `smartshop/avis-api:1.1.0` | **293 Mo** | API GraphQL |
| `smartshop/catalogue-migrate:1.1.0` | **427 Mo** | Migrations, éphémère |

L'image de base `node:22-alpine` pèse **238 Mo** à elle seule : la charge utile
applicative est donc de 84 Mo pour le catalogue et 55 Mo pour les avis.

**Choix d'optimisation, tous mesurés :**

- `npm ci --omit=dev --omit=peer` sur le catalogue. `@prisma/client` déclare
  `prisma` (50 Mo) et `typescript` (23 Mo) en peers **optionnels**, que npm
  installe malgré `--omit=dev`.
- `--omit=peer` est **volontairement absent** du service Avis : npm y retire
  `graphql` bien qu'il soit une dépendance directe, et le conteneur meurt au
  démarrage. Le gain aurait été de 3 Mo.
- **Élagage dans le stage `deps`**, jamais dans le runner : les couches Docker
  sont additives, supprimer après le `COPY` n'allège rien. Sont retirés
  `@prisma/engines`, les moteurs WebAssembly MySQL/SQLite/SQLServer/CockroachDB
  — ce service ne parle qu'à PostgreSQL — ainsi que `@prisma/config` et ses
  dépendances, inutiles à l'exécution et porteuses de trois avis de sécurité.

**Sécurité des images :** `USER node` (uid 1000, jamais root), `tini` comme
PID 1 pour que `SIGTERM` atteigne le process lors des rolling updates,
`HEALTHCHECK` via `wget` fourni par busybox — aucun paquet supplémentaire.
Ni `.env`, ni `tests/`, ni code source TypeScript dans les images finales.

---

## Docker Swarm

Le déploiement se fait **exclusivement** par `docker stack deploy`.
`docker-compose.dev.yml` existe pour le confort de développement local et ne
remplace jamais la stack.

La stack déclare **7 services** :

| Service | Mode | Replicas |
|---|---|---|
| `catalogue-api` | replicated | **3** |
| `avis-api` | replicated | **3** |
| `catalogue-migrate` | replicated | 1 (éphémère) |
| `postgres` | replicated | 1 |
| `mongodb` | replicated | 1 |
| `portainer` | replicated | 1 |
| `portainer-agent` | **global** | 1 par nœud |

### Stratégie de mise à jour

```yaml
update_config:
  parallelism: 1          # imposé par le sujet
  delay: 10s              # imposé par le sujet
  order: start-first
  failure_action: rollback
```

`start-first` fait démarrer le nouveau conteneur **avant** d'arrêter l'ancien :
la mise à jour n'ouvre aucune fenêtre de coupure.

### Migrations du schéma

`postgres → catalogue-migrate → catalogue-api ×3`

Swarm **ignore `depends_on`** : l'ordre de démarrage ne se contrôle pas. Le
service de migration ne le suppose donc pas — il réessaie
`prisma migrate deploy` jusqu'à 30 fois, toutes les 2 secondes, jusqu'à ce que
PostgreSQL réponde. La commande étant idempotente, la rejouer sur une base à
jour affiche « No pending migrations » et sort en 0.

Il tourne avec `restart_policy: condition: none` : une fois terminé, il n'est
pas relancé. **Il apparaît donc normalement en `0/1`.**

Pendant ce temps, les replicas de `catalogue-api` démarrent mais leur `/ready`
renvoie `503` avec `schema: "pending"` tant que les tables n'existent pas.

### Secrets

Aucun mot de passe n'est écrit dans `docker-stack.yml` ni versionné. Quatre
secrets Docker, créés hors dépôt et chiffrés dans le Raft de Swarm :

| Secret | Consommé par | Variable |
|---|---|---|
| `pg_password` | `postgres` | `POSTGRES_PASSWORD_FILE` |
| `mongo_password` | `mongodb` | `MONGO_INITDB_ROOT_PASSWORD_FILE` |
| `catalogue_database_url` | `catalogue-api`, `catalogue-migrate` | `DATABASE_URL_FILE` |
| `avis_mongodb_uri` | `avis-api` | `MONGODB_URI_FILE` |

Swarm monte les secrets **en fichiers** sous `/run/secrets/`, jamais en
variables. Les deux services résolvent la convention `_FILE` au démarrage
(`src/config/secrets.ts`) et réinjectent la valeur dans `process.env` — Prisma
lisant `env("DATABASE_URL")` lui-même depuis son schéma.

---

## Replicas

Les deux API tournent en **3 replicas**, conformément au sujet.

```bash
docker service ls --filter name=smart-shop_catalogue-api
docker service ps smart-shop_catalogue-api
```

Sortie attendue :

```
NAME                       MODE         REPLICAS   IMAGE
smart-shop_catalogue-api   replicated   3/3        smartshop/catalogue-api:1.1.0
smart-shop_avis-api        replicated   3/3        smartshop/avis-api:1.1.0
```

Vérifier la configuration réellement appliquée par Swarm :

```bash
docker service inspect smart-shop_catalogue-api \
  --format 'replicas={{.Spec.Mode.Replicated.Replicas}} parallelism={{.Spec.UpdateConfig.Parallelism}} delay={{.Spec.UpdateConfig.Delay}}'
```

**Pourquoi les bases restent à 1 replica.** Répliquer un conteneur PostgreSQL
ou MongoDB sur le même volume corromprait les données : la haute disponibilité
d'une base exige un vrai cluster (Patroni, replica set), hors périmètre. Le
sujet n'exige 3 replicas que pour « chaque service applicatif (les deux API) ».

---

## Réseau Overlay

Quatre réseaux, **tous de type overlay** :

| Réseau | `internal` | Rattachés |
|---|---|---|
| `smartshop-public` | non | `catalogue-api`, `avis-api`, `portainer` |
| `smartshop-pg` | **oui** | `catalogue-api`, `catalogue-migrate`, `postgres` |
| `smartshop-mongo` | **oui** | `avis-api`, `mongodb` |
| `portainer-agent` | non | `portainer`, `portainer-agent` |

Deux réseaux de données plutôt qu'un seul : avec un réseau commun, `avis-api`
pourrait ouvrir une connexion vers PostgreSQL. La règle « une base par
service » resterait déclarative au lieu d'être imposée par la topologie.

```bash
docker network ls --filter driver=overlay
docker network inspect smart-shop_smartshop-pg --format '{{.Driver}} internal={{.Internal}}'
```

---

## Portainer

Portainer CE 2.21.4 est **intégré à la stack**, accompagné de son agent en
`mode: global` — une tâche par nœud, ce qui donne la vue sur tous les services,
tous les nœuds et les logs en temps réel.

| | |
|---|---|
| URL | `https://localhost:9443` (ou `http://localhost:9000`) |
| Premier accès | créer le compte administrateur |
| Environnement | choisir **Docker Swarm** — l'agent est déjà déployé |

Le certificat est auto-signé : le navigateur affiche un avertissement, à
accepter.

L'agent Portainer est le **seul service autorisé à monter**
`/var/run/docker.sock`. Aucun service applicatif n'y a accès.

---

## Installation

### Prérequis

| Outil | Version minimale | Testé avec |
|---|---|---|
| Docker Engine | 24 | **29.8.1** |
| Docker Compose | v2 | **v5.5.1** |
| Node.js | 22 | v24.11.1 *(pour les tests unitaires hors conteneur)* |
| `curl`, `python3` | — | *(utilisés par les scripts de test)* |

**Ressources Docker : au moins 6 Go de RAM.** La stack fait tourner
10 conteneurs — 3 + 3 API, 2 bases, Portainer et son agent.

**Ports utilisés sur l'hôte :** `3000`, `4000`, `9000`, `9443`.
Les bases n'exposent **aucun** port. Vérifier qu'ils sont libres :

```bash
lsof -nP -iTCP:3000 -iTCP:4000 -iTCP:9443 -sTCP:LISTEN
```

### Récupérer le projet

```bash
git clone https://github.com/Trapman223/SmartShop.git
cd SmartShop
```

### Construire les trois images

```bash
docker build -t smartshop/catalogue-api:1.1.0                       ./service-catalogue-commandes
docker build -t smartshop/catalogue-migrate:1.1.0 --target migrator ./service-catalogue-commandes
docker build -t smartshop/avis-api:1.1.0                            ./service-avis-recommandations

docker images | grep smartshop
```

Le premier build télécharge l'image de base et les dépendances : comptez
quelques minutes.

---

## Initialisation Docker Swarm

```bash
docker swarm init
docker node ls
```

Sortie attendue :

```
ID                          HOSTNAME         STATUS   AVAILABILITY  MANAGER STATUS
5kophpndjmv1k0kruaoyg... *  docker-desktop   Ready    Active        Leader
```

Puis créer les secrets. Le script génère des mots de passe aléatoires :
rien à choisir, rien à retenir, rien à committer par inadvertance.

```bash
./scripts/create-secrets.sh
docker secret ls
```

---

## Déploiement de la Stack

Valider le fichier avant de déployer :

```bash
docker stack config -c docker-stack.yml
```

Déployer :

```bash
docker stack deploy -c docker-stack.yml smart-shop
```

> **Après toute reconstruction d'image**, le tag ne changeant pas, Swarm
> conserve le digest épinglé et `stack deploy` ne remplace pas les tâches.
> Forcer alors la mise à jour :
> ```bash
> docker service update --force smart-shop_catalogue-api
> docker service update --force smart-shop_avis-api
> ```

---

## Vérification des services

```bash
docker stack services smart-shop
docker stack ps smart-shop
```

Sortie attendue après une quinzaine de secondes :

```
NAME                           MODE         REPLICAS   IMAGE
smart-shop_avis-api            replicated   3/3        smartshop/avis-api:1.1.0
smart-shop_catalogue-api       replicated   3/3        smartshop/catalogue-api:1.1.0
smart-shop_catalogue-migrate   replicated   0/1        smartshop/catalogue-migrate:1.1.0
smart-shop_mongodb             replicated   1/1        mongo:7
smart-shop_portainer           replicated   1/1        portainer/portainer-ce:2.21.4
smart-shop_portainer-agent     global       1/1        portainer/agent:2.21.4
smart-shop_postgres            replicated   1/1        postgres:16-alpine
```

> `catalogue-migrate` à **0/1 est normal** : travail ponctuel terminé.

Vérifier la migration :

```bash
docker service logs smart-shop_catalogue-migrate
```

```
1 migration found in prisma/migrations
Applying migration `20260930120000_init`
All migrations have been successfully applied.
migrate: terminé avec succès (tentative 1)
```

Vérifier les sondes :

```bash
curl -s http://localhost:3000/health
curl -s http://localhost:3000/ready    # {"checks":{"postgresql":"up","schema":"ready"}}
curl -s http://localhost:4000/health
curl -s http://localhost:4000/ready    # {"checks":{"mongodb":"up"}}
```

---

## Tests

### Suites unitaires — 236 tests

Elles s'exécutent **hors conteneur** et n'atteignent jamais le réseau ni une
base de données.

```bash
(cd service-catalogue-commandes  && npm ci && npm run lint && npm run typecheck && npm test)
(cd service-avis-recommandations && npm ci && npm run lint && npm run typecheck && npm test)
```

| Service | Tests | Couvre notamment |
|---|---|---|
| `service-catalogue-commandes` | **106** | routes REST, validation, calcul de total, flux 2 et son mode dégradé |
| `service-avis-recommandations` | **130** | queries et mutations GraphQL, scoring, flux 1, garde-fous, masquage des erreurs en production |

### Parcours fonctionnel — contre la stack déployée

```bash
./scripts/smoke-test.sh
```

Vérifie sur le cluster réel : les deux API, le parcours produit → commande →
stock → avis → recommandations → annulation → restitution, **les deux flux
inter-services**, et l'intégrité du stock sous concurrence.

### Test de concurrence — intégrité du stock

Preuve directe du verrou `SELECT … FOR UPDATE`.

```bash
./scripts/concurrency-test.sh                              # 5 en stock, 10 requêtes
./scripts/concurrency-test.sh http://localhost:3000 3 20   # 3 en stock, 20 requêtes
./scripts/concurrency-test.sh http://localhost:3000 1 30   # 1 en stock, 30 requêtes
```

Le script crée un produit au stock maîtrisé, lance N commandes **simultanées**
d'une unité à travers le routing mesh — donc réparties sur les 3 replicas —
dépouille les codes de statut, puis nettoie derrière lui. Il sort en code 0 en
cas de succès : utilisable en CI.

**Résultats mesurés le 01/10/2026** sur la stack Swarm, `catalogue-api` à 3/3 :

| Stock | Requêtes | 201 | 409 | Stock final |
|---:|---:|---:|---:|---:|
| 5 | 10 | 5 | 5 | 0 |
| 5 | 10 | 5 | 5 | 0 |
| 5 | 10 | 5 | 5 | 0 |
| 3 | 20 | 3 | 17 | 0 |
| 1 | 30 | 1 | 29 | 0 |

Aucune survente, aucun stock négatif, aucun code inattendu.

---

## Test de résilience

Exigé par le sujet : prouver que l'application reste disponible après la
suppression manuelle d'un conteneur.

```bash
./scripts/chaos-test.sh catalogue      # ou : avis
```

Le script lance une sonde continue, supprime un replica avec `docker rm -f`,
mesure la disponibilité pendant la replanification, et conserve un journal
horodaté dans `docs/compte-rendu/`.

**Résultats mesurés le 01/10/2026 :**

| Service | Requêtes | Succès | Échecs | Disponibilité |
|---|---:|---:|---:|---:|
| `catalogue-api` | 228 | 228 | 0 | **100 %** |
| `avis-api` | 237 | 237 | 0 | **100 %** |

Pas une seule requête perdue. Les deux replicas survivants absorbent le trafic
pendant que Swarm replanifie la tâche supprimée — c'est le routing mesh qui
écarte automatiquement la tâche morte du load balancing.

### Procédure manuelle

```bash
# 1. Sonde continue, dans un premier terminal
while true; do
  printf '%s %s\n' "$(date +%T)" \
    "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/health)"
  sleep 1
done

# 2. Dans un second terminal, supprimer un replica
docker ps --filter name=smart-shop_catalogue-api --format '{{.ID}} {{.Names}}'
docker rm -f <ID_DU_CONTENEUR>

# 3. Observer Swarm recréer la tâche
docker service ps smart-shop_catalogue-api
docker service ls --filter name=smart-shop_catalogue-api
```

---

## Commandes utiles

```bash
# --- État ---
docker stack services smart-shop
docker stack ps smart-shop --no-trunc
docker service ps smart-shop_catalogue-api

# --- Journaux (JSON structuré, lisible aussi dans Portainer) ---
docker service logs -f smart-shop_catalogue-api
docker service logs smart-shop_catalogue-migrate

# --- Rolling update : observer parallelism=1 et delay=10s ---
docker service update --force smart-shop_catalogue-api
watch -n 1 docker service ps smart-shop_catalogue-api

# --- Montée et descente en charge ---
docker service scale smart-shop_catalogue-api=5
docker service scale smart-shop_catalogue-api=3

# --- Réseaux, volumes, secrets ---
docker network ls --filter driver=overlay
docker volume ls --filter name=smart-shop
docker secret ls

# --- Rejouer les migrations (idempotent) ---
docker service update --force smart-shop_catalogue-migrate

# --- Documentation des API ---
open http://localhost:3000/docs        # Swagger UI
open http://localhost:4000/graphql     # Apollo Sandbox
open https://localhost:9443            # Portainer
```

---

## Arrêt/Suppression de la stack

```bash
# Retirer la stack — les volumes survivent
docker stack rm smart-shop

# Repartir d'une base vierge
docker volume rm smart-shop_pgdata smart-shop_mongodata smart-shop_portainer_data

# Supprimer les secrets (immuables : il faut les recréer pour les changer)
docker secret rm pg_password mongo_password catalogue_database_url avis_mongodb_uri

# Quitter le Swarm
docker swarm leave --force
```

### Dépannage

| Symptôme | Cause probable | Correction |
|---|---|---|
| API bloquée en `0/3` | Image absente, ou variable manquante | `docker service ps <svc> --no-trunc` puis `docker service logs <svc>` |
| `/ready` → `{"schema":"pending"}` | Migrations non appliquées | `docker service logs smart-shop_catalogue-migrate` |
| `catalogue-migrate` en `0/1` | **Normal** — travail ponctuel terminé | Vérifier `Complete` dans `docker service ps` |
| `port already in use` | Un service natif occupe le port | `lsof -nP -iTCP:5432 -sTCP:LISTEN` — un PostgreSQL hôte est fréquent |
| Image reconstruite sans effet | Tag inchangé, digest épinglé | `docker service update --force <svc>` |
| Secret modifié sans effet | Les secrets Swarm sont **immuables** | `docker stack rm`, `docker secret rm`, recréer, redéployer |
| Tâches en `Rejected` | Image introuvable par le nœud | En multi-nœuds, un registre local est nécessaire |

---

## Auteur

**Souleymane C.** — <souleymanec7020@gmail.com>

Dépôt : <https://github.com/Trapman223>

Projet académique réalisé dans le cadre de l'examen de rattrapage
*Développement d'applications distribuées*.

### Périmètre de validation

Tout ce qui est annoncé dans ce README a été exécuté sur la configuration
suivante, le **1ᵉʳ octobre 2026** :

- macOS, Docker Desktop **29.8.1**, Docker Compose **v5.5.1**
- **Swarm mono-nœud** — les 3 replicas tournent sur la même machine. Le
  routing mesh, le rolling update et la résilience se démontrent pleinement,
  mais un déploiement multi-nœuds n'a pas été testé et nécessiterait un
  registre d'images accessible depuis chaque nœud.
- Les chiffres de tests, de disponibilité et de taille d'image proviennent
  d'exécutions réelles, pas d'estimations.

### Limite connue

Apollo Server 4 est en fin de support depuis le 26 janvier 2026. Le service
fonctionne, mais une migration vers Apollo Server 5 serait nécessaire pour un
usage au-delà du cadre de cet examen.
