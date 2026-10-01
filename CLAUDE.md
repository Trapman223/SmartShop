# CLAUDE.md — Règles permanentes du projet Smart-Shop

> Ce fichier fait autorité sur toute décision technique du projet.
> En cas de conflit entre une suggestion, une habitude de code et ce document,
> **ce document gagne**. En cas de conflit entre ce document et le sujet
> d'examen, **le sujet d'examen gagne** et ce document doit être corrigé.

---

## 0. RÈGLES INVIOLABLES (à lire avant toute action)

Ces règles proviennent directement du sujet d'examen. Elles ne sont
**jamais** négociables, **jamais** « optimisables », **jamais** contournables
pour gagner du temps ou simplifier le code.

| # | Règle | Interdiction absolue |
|---|---|---|
| I1 | Le **service 1** expose une **API REST** | Ne **jamais** remplacer REST par GraphQL dans le service 1 |
| I2 | Le **service 2** expose une **API GraphQL** | Ne **jamais** remplacer GraphQL par REST dans le service 2 |
| I3 | Le **service 1** utilise **PostgreSQL** | Ne **jamais** remplacer PostgreSQL par MongoDB pour le service 1 |
| I4 | Le **service 2** utilise **MongoDB** | Ne **jamais** remplacer MongoDB par PostgreSQL pour le service 2 |
| I5 | Chaque API applicative tourne en **3 replicas** | Ne **jamais** supprimer, réduire ni « temporairement » passer à 1 replica |
| I6 | L'orchestration est **Docker Swarm** (`docker stack deploy`) | Ne **jamais** utiliser Docker Compose comme remplacement du Swarm demandé |
| I7 | `update_config` = `parallelism: 1`, `delay: 10s` | Ne **jamais** modifier ces deux valeurs |
| I8 | Le réseau inter-services est de type **overlay** | Ne **jamais** utiliser `bridge` ou `host` dans `docker-stack.yml` |
| I9 | **Portainer** est intégré à la stack | Ne **jamais** le sortir de `docker-stack.yml` |
| I10 | Endpoints REST exigés : `GET /products`, `POST /orders`, `DELETE /orders/{id}` | Ne **jamais** renommer, déplacer ni supprimer ces trois routes |
| I11 | GraphQL exigé : queries (avis, historique, recommandations) + mutations (créer/modifier un avis) | Ne **jamais** réduire ce périmètre |
| I12 | Arborescence exigée : `/service-catalogue-commandes`, `/service-avis-recommandations`, `docker-stack.yml` à la racine, `README.md` | Ne **jamais** renommer ces dossiers ni déplacer ces fichiers |

**Règle transverse :** ne **jamais** introduire une technologie supplémentaire
(librairie, framework, broker, cache, proxy, ORM, service tiers) **sans
justification écrite**. Toute nouvelle dépendance doit répondre par écrit à :
*quel besoin du sujet elle sert*, *pourquoi la stdlib ou l'existant ne suffit
pas*, *quel coût elle ajoute à l'image Docker*. Si la réponse n'est pas
évidente, la dépendance est refusée.

---

## 1. Objectif du projet

Construire **Smart-Shop**, une plateforme e-commerce distribuée composée de
**deux microservices indépendants**, chacun avec sa propre responsabilité, sa
propre pile technologique et sa propre base de données, communiquant entre eux
sur un réseau overlay, déployés en **Docker Swarm** en mode Stack et supervisés
par **Portainer**.

Le projet est un **rendu d'examen de rattrapage** (Développement d'applications
distribuées). Il est noté sur 20 points :

| Critère | Points |
|---|---|
| Qualité des API (REST / GraphQL) | 5 |
| Gestion des données (SQL / NoSQL) | 4 |
| Dockerisation & optimisation des images | 3 |
| Orchestration Swarm (replicas / réseaux) | 5 |
| Monitoring & clarté du compte-rendu | 3 |

**Conséquence pratique :** toute décision doit être défendable devant un
correcteur. Le code doit être lisible, la justification doit être écrite, et
chaque exigence du sujet doit être **démontrable** (capture, log, commande).

---

## 2. Architecture des deux microservices

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
                  │  pgdata    │        │ mongodata  │
                  └────────────┘        └────────────┘
```

### Service 1 — `service-catalogue-commandes`

- **Responsabilité :** catalogue de produits (référence, prix, stock) et
  commandes clients.
- **Exposition :** **API REST** sur le port `3000`.
- **Base :** **PostgreSQL 16**, pour l'intégrité transactionnelle
  (stock ↔ commande ↔ montant).
- **Invariant métier :** le stock ne peut jamais devenir négatif, même sous
  3 replicas concurrents.

### Service 2 — `service-avis-recommandations`

- **Responsabilité :** avis clients, notes produits, historique de navigation,
  recommandations personnalisées en temps réel.
- **Exposition :** **API GraphQL** sur le port `4000` (`/graphql`).
- **Base :** **MongoDB 7**, pour la flexibilité du schéma (texte libre, tags
  variables, métadonnées hétérogènes, historique d'édition imbriqué).

### Communication inter-services (bidirectionnelle, obligatoire)

Le sujet exige que les deux services **communiquent entre eux**. Les deux flux
suivants font partie du périmètre et ne doivent pas être supprimés :

- **Flux 1 — `avis-api` → `catalogue-api` (REST).** Les champs `Product` des
  types GraphQL (`Review.product`, `Recommendation.product`,
  `ProductRating.product`) sont résolus en appelant
  `GET http://catalogue-api:3000/products/batch?refs=...`.
  **Obligatoire :** batching via **DataLoader** — aucun resolver ne doit
  produire de N+1.
- **Flux 2 — `catalogue-api` → `avis-api` (GraphQL).** `GET /products` enrichit
  chaque produit de sa note moyenne via la query `productRatings(refs: [...])`.
  **Obligatoire :** timeout **800 ms** et **fallback `rating: null`** — si
  `avis-api` est indisponible, le catalogue reste servi en mode dégradé.

**Règles de communication :**
- L'adressage se fait **toujours par nom de service Swarm**
  (`catalogue-api`, `avis-api`), **jamais** par IP ni par `localhost`.
- Aucun service ne lit ni n'écrit dans la base de l'autre. **Une base par
  service, sans exception.**
- L'en-tête `X-Request-Id` est généré à l'entrée et propagé sur tout appel
  sortant, pour que les logs des 6 replicas soient corrélables dans Portainer.

---

## 3. Technologies utilisées

| Couche | Service 1 | Service 2 |
|---|---|---|
| Runtime | Node.js 22 LTS | Node.js 22 LTS |
| Langage | TypeScript 5.7 (`strict: true`) | TypeScript 5.7 (`strict: true`) |
| Framework | Express 5 | Apollo Server 4 monté sur Express 4 |
| Base de données | PostgreSQL 16 | MongoDB 7 |
| Accès données | **Prisma ORM** + migrations Prisma | **Mongoose ODM** |
| Validation | `zod` | `zod` sur les inputs |
| Logs | `pino` (JSON structuré) | `pino` (JSON structuré) |
| Tests | `vitest` + `supertest` | `vitest` + `executeOperation` |
| Image de base | `node:22-alpine` | `node:22-alpine` |

**Décisions verrouillées (ne pas revenir dessus sans justification écrite) :**

- **Prisma pour PostgreSQL.** Choix validé explicitement (étape 2). Trois
  conséquences à assumer et à traiter, elles ne sont pas optionnelles :
  1. **Le verrou pessimiste reste obligatoire.** Prisma n'expose pas
     `SELECT ... FOR UPDATE` dans son API fluide : `POST /orders` doit
     l'émettre via `prisma.$transaction` + `prisma.$queryRaw`, avec
     `ORDER BY id` pour éviter les interblocages. Sans cela, l'intégrité du
     stock sous 3 replicas concurrents n'est pas garantie.
  2. **La contrainte `CHECK (stock >= 0)` n'est pas exprimable en Prisma :**
     elle est ajoutée par une migration SQL manuelle à l'étape 3. C'est le
     filet de sécurité au niveau du moteur, il ne doit pas être omis.
  3. **Le query engine natif alourdit l'image** (~20 Mo) et impose
     `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]` plus le paquet
     `openssl` dans l'image Alpine. La cible de taille est revue à **< 220 Mo**
     pour ce service (cf. section 9, règle 11).
- **Mongoose pour MongoDB.** Choix validé explicitement (étape 2). La
  flexibilité du schéma — argument central du choix NoSQL dans le compte-rendu —
  doit rester démontrable : les champs libres (`metadata` des événements de
  navigation, `tags`, `editHistory`) sont typés en `Schema.Types.Mixed` ou
  déclarés avec `{ strict: false }` sur le sous-document concerné, jamais
  figés en schéma strict.
- **Apollo Server est monté sur Express, pas en mode standalone.** Le mode
  standalone ne permet pas d'exposer `/health` et `/ready` sur le même port que
  `/graphql`, or le `HEALTHCHECK` Docker en dépend. Ce service utilise
  **Express 4** (et non 5) car c'est la version supportée par
  `@apollo/server/express4`.
- **Pas de broker de messages, pas de cache Redis, pas d'API gateway.** Le
  sujet ne les demande pas ; ils ajouteraient des conteneurs et des points de
  défaillance sans gagner un seul point au barème.
- **Pas de `body-parser`.** Express fournit `express.json()` : la dépendance
  est redondante, et son export CJS `json` n'est pas importable en ESM.

---

## 4. Contraintes obligatoires de l'examen

Checklist de conformité. Chaque ligne doit être vérifiable par une commande ou
une capture avant le rendu.

**Service Catalogue & Commandes**
- [ ] API REST
- [ ] Base relationnelle PostgreSQL
- [ ] Gestion produits : référence, prix, stock
- [ ] Gestion des commandes
- [ ] `GET /products`
- [ ] `POST /orders`
- [ ] `DELETE /orders/{id}`

**Service Avis & Recommandations**
- [ ] API GraphQL
- [ ] Base NoSQL MongoDB
- [ ] Gestion des avis clients
- [ ] Notes produits
- [ ] Recommandations personnalisées en temps réel
- [ ] Queries : historique des avis, recommandations
- [ ] Mutations : poster un avis, modifier un avis

**Déploiement & orchestration**
- [ ] Une image Docker par service **et** par base de données
- [ ] Déploiement en mode **Stack** (`docker stack deploy`)
- [ ] **3 replicas** pour chacune des deux API
- [ ] `update_config` : `parallelism: 1`, `delay: 10s`
- [ ] Réseau **overlay**
- [ ] **Portainer** intégré à la stack

**Dépôt GitHub**
- [ ] `/service-catalogue-commandes` (code source + Dockerfile)
- [ ] `/service-avis-recommandations` (code source + Dockerfile)
- [ ] `docker-stack.yml` à la racine
- [ ] `README.md` détaillant l'initialisation du Swarm et le lancement de la Stack

**Compte-rendu PDF (envoyé par email)**
- [ ] Schéma d'architecture détaillé avec flux de données
- [ ] Justification du choix des bases (pourquoi SQL ici, NoSQL là)
- [ ] Captures Portainer montrant les services actifs avec leurs **3 replicas**
- [ ] Test de résilience : capture prouvant que l'application reste disponible
      après suppression manuelle d'un conteneur

---

## 5. Conventions TypeScript

**`tsconfig.json` — non négociable dans les deux services :**

```jsonc
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "outDir": "dist",
    "rootDir": "src",
    "sourceMap": true,
    "declaration": false
  }
}
```

**Règles de code :**

1. **`any` est interdit.** Utiliser `unknown` puis restreindre par validation
   `zod` ou par garde de type. Une seule exception tolérée : l'interop avec une
   librairie non typée, accompagnée d'un commentaire `// eslint-disable` motivé.
2. **Toute entrée externe est validée avant usage** — corps de requête, query
   params, variables GraphQL, variables d'environnement, réponse d'un autre
   service. La frontière du service est la frontière de la confiance.
3. **Les variables d'environnement sont lues en un seul point**
   (`src/config/env.ts`), validées par `zod` au démarrage. `process.env`
   n'apparaît **nulle part ailleurs**. Si une variable obligatoire manque, le
   service refuse de démarrer avec un message explicite.
4. **Pas d'export par défaut** (sauf contrainte d'outil). Exports nommés
   uniquement : la recherche dans le dépôt reste fiable.
5. **`async/await` partout.** Pas de `.then()` chaîné, pas de callbacks.
   Toute promesse est attendue ou explicitement gérée — pas de floating promise.
6. **Erreurs typées.** Une hiérarchie `AppError` avec
   `NotFoundError`, `ValidationError`, `ConflictError`, `UpstreamError`.
   Ne **jamais** faire `throw new Error("...")` brut dans la couche métier.
7. **Architecture en couches, dépendances à sens unique :**
   `routes → controllers → services → repositories → db`.
   Un repository ne connaît **jamais** Express ni GraphQL. Un service ne
   manipule **jamais** `req` / `res`. Le SQL et les requêtes Mongo vivent
   exclusivement dans les repositories.
8. **Les montants monétaires ne transitent jamais en flottant depuis la base.**
   `NUMERIC` PostgreSQL est lu en `string` puis converti explicitement.
9. **Arrêt propre obligatoire.** Sur `SIGTERM` : arrêter d'accepter de nouvelles
   connexions, terminer les requêtes en cours, fermer le pool DB, sortir en 0.
   Swarm envoie `SIGTERM` à chaque rolling update — sans cela, le
   `delay: 10s` ne protège de rien.
10. **Aucun `console.log` en production.** Uniquement `pino`, en JSON, pour que
    les logs soient lisibles dans Portainer.

---

## 6. Conventions de nommage

| Élément | Convention | Exemple |
|---|---|---|
| Dossiers | `kebab-case` | `service-catalogue-commandes` |
| Fichiers TS | `camelCase.ts` + suffixe de rôle | `order.service.ts`, `products.routes.ts` |
| Classes / types / interfaces | `PascalCase` | `OrderService`, `CreateOrderInput` |
| Variables / fonctions | `camelCase` | `computeTotalAmount` |
| Constantes globales | `UPPER_SNAKE_CASE` | `DEFAULT_PAGE_SIZE` |
| Variables d'environnement | `UPPER_SNAKE_CASE` | `PG_HOST`, `AVIS_SERVICE_URL` |
| Tables SQL | `snake_case`, pluriel | `products`, `order_items` |
| Colonnes SQL | `snake_case` | `unit_price`, `created_at` |
| Types SQL personnalisés | `snake_case` | `order_status` |
| Collections MongoDB | `snake_case`, pluriel | `reviews`, `browsing_events` |
| Champs MongoDB | `camelCase` | `productRef`, `helpfulVotes` |
| Types GraphQL | `PascalCase` | `Review`, `ProductRating` |
| Champs GraphQL | `camelCase` | `averageRating` |
| Enums GraphQL | `PascalCase` / valeurs `UPPER_SNAKE_CASE` | `ReviewSort.HIGHEST_RATING` |
| Routes REST | `kebab-case`, noms au pluriel | `/products`, `/orders/{id}` |
| Services Swarm | `kebab-case` | `catalogue-api`, `avis-api` |
| Images Docker | `smartshop/<service>:<semver>` | `smartshop/catalogue-api:1.0.0` |
| Réseaux overlay | `smartshop-<rôle>` | `smartshop-public`, `smartshop-data` |
| Volumes | `snake_case` | `pgdata`, `mongodata`, `portainer_data` |
| Références produit | `SS-PRD-#####` | `SS-PRD-00123` |
| Branches Git | `<type>/<description-courte>` | `feat/orders-transaction` |

**Frontières de casse à respecter :** SQL en `snake_case`, JSON / GraphQL en
`camelCase`. La conversion se fait **dans le repository**, jamais ailleurs.

---

## 7. Structure des dossiers

L'arborescence ci-dessous est la structure de référence. Les trois chemins
marqués **[EXIGÉ]** proviennent du sujet et ne peuvent pas être renommés ni
déplacés.

```
SmartShop/
├── CLAUDE.md
├── README.md                          [EXIGÉ]
├── docker-stack.yml                   [EXIGÉ - à la racine]
├── docker-compose.dev.yml             (dev local uniquement, jamais le rendu)
├── Makefile
├── .gitignore  .env.example  .editorconfig
│
├── service-catalogue-commandes/       [EXIGÉ]
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── package.json  tsconfig.json  vitest.config.ts
│   ├── prisma/
│   │   ├── schema.prisma              modèles Product, Order, OrderItem
│   │   ├── migrations/                dont les contraintes CHECK manuelles
│   │   └── seed.ts                    jeu de données de démonstration
│   ├── src/
│   │   ├── server.ts                  bootstrap + arrêt propre (SIGTERM)
│   │   ├── app.ts                     montage Express
│   │   ├── config/env.ts              lecture + validation zod des variables
│   │   ├── config/openapi.ts          spécification OpenAPI 3.1 (servie sur /docs)
│   │   ├── db/prisma.ts               client Prisma + retry exponentiel
│   │   ├── routes/                    health, docs, products, orders
│   │   ├── controllers/               HTTP uniquement, zéro logique métier
│   │   ├── services/                  logique métier, zéro HTTP
│   │   ├── repositories/              accès Prisma uniquement, dont les transactions
│   │   ├── validators/                schémas zod des entrées
│   │   ├── utils/                     money, pagination, orderCalculation, serializers
│   │   ├── clients/avisClient.ts      flux 2 (timeout 800ms + fallback)
│   │   ├── errors/                    hiérarchie AppError
│   │   └── middlewares/               validate, errorHandler, requestId
│   └── tests/{unit,integration,helpers}/
│
├── service-avis-recommandations/      [EXIGÉ]
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── package.json  tsconfig.json  vitest.config.ts
│   ├── src/
│   │   ├── server.ts
│   │   ├── schema/typeDefs.ts, schema.graphql
│   │   ├── resolvers/                 Query, Mutation, Review, Product
│   │   ├── db/client.ts, indexes.ts
│   │   ├── services/                  review, rating, recommendation, history
│   │   ├── repositories/              requêtes et pipelines Mongo uniquement
│   │   ├── clients/catalogueClient.ts flux 1 + DataLoader
│   │   ├── errors/
│   │   └── context.ts
│   └── tests/{unit,integration}/
│
├── scripts/
│   ├── init-swarm.sh  build-images.sh  deploy-stack.sh
│   ├── smoke-test.sh  chaos-test.sh  load-test.js
│
├── docs/
│   ├── architecture.md  architecture.mmd  architecture.png
│   ├── adr/                           001-postgresql, 002-mongodb, 003-communication-http
│   ├── compte-rendu/compte-rendu.md + captures/
│   └── api/rest-examples.http, graphql-examples.md
│
└── .github/workflows/ci.yml
```

**Règles :** un fichier = une responsabilité ; pas de fichier `utils.ts`
fourre-tout ; pas de code partagé par copier-coller entre les deux services —
s'ils ont besoin de la même chose, chacun l'implémente chez lui (ce sont des
microservices indépendants, pas un monolithe découpé).

---

## 8. Règles de sécurité

1. **Aucun secret dans le dépôt.** Ni mot de passe, ni URI de connexion complète,
   ni token. `.env` est dans `.gitignore`. Seul `.env.example` est versionné,
   avec des valeurs factices.
2. **Docker secrets en production.** Les mots de passe PostgreSQL et MongoDB
   passent par `docker secret create` et sont lus via les variables `*_FILE`
   (`POSTGRES_PASSWORD_FILE`, `MONGO_INITDB_ROOT_PASSWORD_FILE`). Jamais en
   clair dans `docker-stack.yml`.
3. **Conteneurs non-root.** Chaque Dockerfile applicatif se termine par
   `USER node`. Aucun service applicatif ne tourne en root.
4. **Bases jamais exposées publiquement.** PostgreSQL et MongoDB n'ont **aucun**
   bloc `ports:` dans `docker-stack.yml` et vivent sur le réseau overlay
   `smartshop-data` déclaré `internal: true`.
5. **Requêtes SQL exclusivement paramétrées** (`$1`, `$2`, …). Toute
   concaténation de chaîne dans une requête SQL est un défaut bloquant.
6. **Pas d'opérateur Mongo construit depuis une entrée utilisateur.** Les
   entrées sont validées et les champs sont mappés explicitement — jamais
   `collection.find(req.body)`.
7. **Validation stricte des entrées** : bornes sur `rating` (1..5), `quantity`
   (> 0), longueur maximale des textes libres, liste blanche des champs de tri
   et de pagination (`limit` plafonné).
8. **Protection GraphQL** : profondeur de requête limitée, introspection
   autorisée (utile au correcteur) mais messages d'erreur internes masqués en
   production — `stack trace` jamais renvoyée au client.
9. **Pas de fuite d'information dans les erreurs.** Le client reçoit un message
   métier et un `traceId` ; le détail technique part dans les logs `pino`.
10. **Le socket Docker (`/var/run/docker.sock`) n'est monté que par l'agent
    Portainer**, sur le nœud manager. Aucun service applicatif n'y a accès.
11. **Dépendances minimales et à jour.** `npm audit` doit passer sans
    vulnérabilité critique avant le rendu.
12. **Limites de ressources obligatoires** sur chaque service (`resources.limits`) :
    un conteneur qui dérive ne doit pas emporter le nœud entier.

---

## 9. Règles Docker

1. **Dockerfile multi-stage obligatoire** pour les deux services :
   `builder` (compilation TypeScript) → `deps` (`npm ci --omit=dev`) →
   `runner` (image finale minimale).
2. **Image de base `node:22-alpine`**, version épinglée. Jamais `latest`,
   jamais `node:22` (variante complète).
3. **Ordre des couches optimisé pour le cache** : copier `package*.json` et
   lancer `npm ci` **avant** de copier `src/`.
4. **`npm ci`, jamais `npm install`** dans un Dockerfile —
   le build doit être reproductible à partir du lockfile.
5. **`.dockerignore` obligatoire** : `node_modules`, `dist`, `tests`, `docs`,
   `.git`, `*.md`, `.env`. Le contexte de build doit rester petit.
6. **`USER node`** avant `CMD`. Aucun conteneur applicatif en root.
7. **`tini` comme PID 1** (`ENTRYPOINT ["/sbin/tini","--"]`), pour que `SIGTERM`
   atteigne bien le process Node lors des rolling updates.
8. **`HEALTHCHECK` obligatoire** dans chaque Dockerfile applicatif, pointant sur
   `/health`. Sans healthcheck, `order: start-first` n'a aucun effet et la
   stratégie de mise à jour ne protège de rien.
9. **Une image par service et par base de données** (exigence du sujet). Les
   bases utilisent les images officielles `postgres:16-alpine` et `mongo:7`.
10. **Tag en version sémantique** : `smartshop/catalogue-api:1.0.0`. Jamais
    `latest` dans `docker-stack.yml` — un `latest` rend le rolling update
    indéterministe.
11. **Cibles de taille — MESURÉES, pas supposées.** L'image de base
    `node:22-alpine` pèse à elle seule **238 Mo** : les cibles annoncées
    initialement (160/220 Mo) étaient donc sous le plancher. Valeurs
    réelles au 30/09/2026, à ne pas dépasser :
    - `catalogue-api` : **368 Mo** (238 base + 130 de charge utile)
    - `avis-api` : **293 Mo** (238 base + 55 de charge utile)

    Deux optimisations obtenues par mesure, à ne pas défaire :
    - **`--omit=peer` sur `catalogue-api` uniquement.** `@prisma/client`
      déclare `prisma` (50 Mo) et `typescript` (23 Mo) en peers OPTIONNELS,
      que npm installe malgré `--omit=dev`.
    - **`--omit=peer` est INTERDIT sur `avis-api`** : npm y retire `graphql`
      bien qu'il soit une dépendance directe, et le conteneur meurt sur
      « Cannot find package 'graphql' ». Gain mesuré : 3 Mo. Ne pas retenter.
    - **Élagage des moteurs Prisma dans le stage `deps`** (jamais dans le
      runner : les couches sont additives, supprimer après le COPY n'allège
      rien) : `@prisma/engines` et les moteurs wasm MySQL/SQLite/SQLServer/
      CockroachDB, inutilisés. Total : 604 Mo → 368 Mo.

    La taille finale est
    mesurée (`docker images`) et reportée dans le compte-rendu — elle est
    directement notée (3 pts « optimisation des images »).
12. **Pas de code source, pas de devDependencies, pas de tests dans l'image
    finale.** Seuls `dist/`, `node_modules` de production et `package.json`.

---

## 10. Règles Docker Swarm

1. **`docker-stack.yml` est à la racine** du dépôt et est le **seul** fichier de
   déploiement du rendu. `docker-compose.dev.yml` existe pour le confort de
   développement local et **ne remplace jamais** la stack Swarm.
2. **Déploiement uniquement par `docker stack deploy -c docker-stack.yml smartshop`.**
   `docker compose up` n'est **jamais** la procédure de rendu.
3. **`replicas: 3` sur `catalogue-api` et sur `avis-api`.** Valeur figée.
4. **`update_config` figé sur les deux API :**
   ```yaml
   update_config:
     parallelism: 1        # imposé par le sujet
     delay: 10s            # imposé par le sujet
     order: start-first
     failure_action: rollback
     monitor: 30s
   ```
5. **Réseaux overlay uniquement :**
   - `smartshop-public` — overlay, `attachable: true` : trafic entrant et
     communication inter-API.
   - `smartshop-data` — overlay, `internal: true` : accès aux bases, isolé de
     l'extérieur.
   Aucun réseau `bridge` ou `host` dans `docker-stack.yml`.
6. **Bases de données en `replicas: 1`**, avec
   `placement.constraints: [node.role == manager]` et un volume nommé.
   Répliquer un conteneur de base sur le même volume corromprait les données ;
   le sujet n'exige 3 replicas que pour les **services applicatifs**. Cette
   décision doit être **écrite et justifiée** dans le compte-rendu.
7. **`restart_policy` obligatoire** sur chaque service :
   `condition: any`, `delay: 5s`, `max_attempts: 3`, `window: 120s`.
   C'est ce qui produit la preuve de résilience après suppression d'un conteneur.
8. **`depends_on` n'existe pas en Swarm.** L'ordre de démarrage ne se contrôle
   pas : chaque API **doit** implémenter un retry exponentiel à la connexion
   base (5 tentatives, 1 → 16 s) et distinguer `/health` (liveness) de `/ready`
   (readiness, base joignable).
9. **Portainer fait partie de la stack** : `portainer/portainer-ce` sur le
   manager (ports `9443` / `9000`, volume `portainer_data`) **et**
   `portainer/agent` en `mode: global` pour voir tous les nœuds, tous les
   services et tous les logs.
10. **`resources.limits` et `resources.reservations`** définis sur chaque
    service.
11. **Aucune modification de la stack « pour faire passer un test ».** Si un
    déploiement échoue, on corrige la cause, jamais la contrainte du sujet.
12. **Vérification systématique après déploiement :**
    `docker service ls` doit afficher `3/3` pour les deux API avant toute
    capture d'écran ou tout commit de résultat.

---

## 11. Règles de tests

1. **Aucune fonctionnalité n'est considérée terminée sans test.** Un endpoint
   REST ou une opération GraphQL livrée sans test est du travail incomplet.
2. **Tests unitaires** (`vitest`) sur la couche `services/` : calcul de total,
   transitions de statut de commande, scoring de recommandation, validation.
   Cible : **≥ 70 % de couverture** sur `services/`.
3. **Tests d'intégration** sur PostgreSQL et MongoDB réels (Testcontainers ou
   conteneurs éphémères). **Jamais de mock de base de données** : c'est
   précisément le comportement transactionnel qu'on doit prouver.
4. **Test de concurrence obligatoire et non supprimable :** 10 `POST /orders`
   simultanés sur un stock de 5 doivent produire **exactement 5 succès et
   5 réponses `409`**. C'est la preuve directe du `SELECT ... FOR UPDATE` et de
   l'intégrité sous 3 replicas.
5. **Couverture des routes :** 100 % des routes REST testées via `supertest`,
   100 % des queries et mutations GraphQL testées via `executeOperation`,
   incluant les cas d'erreur (`400`, `404`, `409`).
6. **Test du mode dégradé :** `GET /products` doit répondre `200` avec
   `rating: null` lorsque `avis-api` est injoignable. Ce test protège le
   fallback contre une régression.
7. **`scripts/smoke-test.sh`** : parcours complet exécuté contre la stack
   déployée (lister produits → créer commande → vérifier stock → poster un avis
   → lire les recommandations → annuler la commande → vérifier la restitution du
   stock).
8. **`scripts/chaos-test.sh`** : boucle de requêtes continue pendant la
   suppression manuelle d'un conteneur (`docker rm -f`), comptage des échecs et
   mesure du temps de reconvergence Swarm. **La sortie horodatée de ce script
   est un livrable du compte-rendu.**
9. **`scripts/load-test.js`** : montée en charge documentée (p95, répartition
   des requêtes sur les 3 replicas). **Livrable du compte-rendu.**
10. **Tests déterministes** : pas de dépendance à l'horloge réelle, pas d'ordre
    d'exécution implicite, base nettoyée entre les tests.
11. **CI GitHub Actions bloquante** : `lint → typecheck → test → docker build
    (2 images) → docker stack config -c docker-stack.yml` (validation syntaxique
    de la stack sans cluster).
12. **Aucun test ne doit être désactivé (`.skip`) au moment du rendu.**

---

## 12. Règles Git

1. **Branche principale `main`**, toujours dans un état déployable.
2. **Une branche par étape du plan d'exécution :**
   `feat/<sujet>`, `fix/<sujet>`, `docs/<sujet>`, `chore/<sujet>`, `test/<sujet>`.
   Exemples : `feat/orders-transaction`, `chore/docker-swarm-stack`.
3. **Commits en Conventional Commits**, en français, à l'impératif :
   ```
   feat(catalogue): ajoute POST /orders avec verrou transactionnel sur le stock
   fix(avis): corrige le N+1 sur Review.product via DataLoader
   chore(swarm): fixe update_config a parallelism 1 et delay 10s
   docs(readme): documente l'initialisation du Swarm
   test(catalogue): ajoute le test de concurrence sur le stock
   ```
   Portées autorisées : `catalogue`, `avis`, `swarm`, `docker`, `docs`, `ci`, `scripts`.
4. **Commits atomiques.** Un commit = un changement cohérent. Pas de commit
   fourre-tout « wip », « update », « fix ».
5. **Ne jamais committer :** `.env`, `node_modules/`, `dist/`, `coverage/`,
   `*.log`, secrets, dumps de base, captures temporaires.
6. **Ne jamais réécrire l'historique de `main`** (`push --force` interdit).
7. **`git commit` et `git push` uniquement sur demande explicite.** Aucun commit
   automatique après une modification de fichier.
8. **Aucune suppression de fichier sans demande explicite.**
9. **Le dépôt doit rester clonable et déployable en trois commandes** documentées
   dans le README. Un correcteur doit pouvoir partir d'un clone vierge.
10. **Tag final `v1.0.0`** sur le commit de rendu.

---

## 13. Règles README

Le `README.md` à la racine est **exigé par le sujet** et explicitement noté sur
la clarté. Il est écrit **pour le correcteur**, pas pour nous. Il doit permettre
de partir d'un clone vierge et d'arriver à une stack fonctionnelle **sans poser
la moindre question**.

Sections obligatoires, dans cet ordre :

1. **Présentation** — le projet en 5 lignes, les deux services, leur rôle.
2. **Schéma d'architecture** — diagramme et les deux flux inter-services.
3. **Prérequis** — Docker, versions minimales, ressources RAM à allouer, ports
   utilisés (`3000`, `4000`, `9443`).
4. **Initialisation du Swarm** — `docker swarm init`, vérification `docker node ls`.
5. **Création des secrets** — `docker secret create` pour les mots de passe.
6. **Build des images** — commandes exactes, tags attendus, taille des images.
7. **Lancement de la Stack** — `docker stack deploy -c docker-stack.yml smartshop`.
8. **Vérification** — `docker service ls` avec la sortie attendue montrant
   **`3/3`** sur les deux API.
9. **Accès aux interfaces** — Portainer (`https://localhost:9443`, avertissement
   certificat auto-signé), Swagger UI (`/docs`), Apollo Sandbox (`/graphql`).
10. **Exemples d'utilisation** — `curl` pour `GET /products`, `POST /orders`,
    `DELETE /orders/{id}` ; requêtes GraphQL pour les avis et les
    recommandations. **Copiables-collables et testés.**
11. **Tests** — lancement des suites, du smoke test, du chaos test, du test de charge.
12. **Rolling update** — comment observer `parallelism: 1` et `delay: 10s`.
13. **Test de résilience** — comment tuer un conteneur et constater la
    disponibilité continue.
14. **Justification SQL vs NoSQL** — version courte, renvoi vers `docs/adr/`.
15. **Arrêt et nettoyage** — `docker stack rm`, suppression des volumes.
16. **Dépannage** — ports occupés, images introuvables, service bloqué en `0/3`.

**Règles d'écriture :** chaque commande est **testée avant d'être écrite** ; la
sortie attendue est montrée pour les commandes de vérification ; aucun
« il suffit de » ni aucune étape implicite ; un README par service documente en
plus ses variables d'environnement et son lancement en développement.

---

## 14. Critères de validation finale

Le projet n'est considéré **terminé** que lorsque **tous** les points ci-dessous
sont vérifiés. Ne jamais annoncer le projet comme fini sur une base partielle —
lister explicitement ce qui manque.

**Code et API**
- [ ] `GET /products`, `POST /orders`, `DELETE /orders/{id}` fonctionnels et testés
- [ ] Queries GraphQL : avis, historique des avis, recommandations
- [ ] Mutations GraphQL : créer un avis, modifier un avis
- [ ] Les deux flux de communication inter-services fonctionnent
- [ ] Mode dégradé vérifié : `GET /products` répond encore si `avis-api` est down
- [ ] `npm run typecheck` et `npm run lint` passent sans erreur sur les deux services

**Données**
- [ ] Schéma PostgreSQL avec contraintes (`CHECK stock >= 0`, FK, UNIQUE)
- [ ] `POST /orders` transactionnel avec `SELECT ... FOR UPDATE`
- [ ] `DELETE /orders/{id}` restitue le stock dans la même transaction
- [ ] Index MongoDB créés (unique, texte, TTL)
- [ ] Jeux de données de démonstration chargés dans les deux bases

**Docker**
- [ ] Un Dockerfile multi-stage par service
- [ ] Images non-root, avec `HEALTHCHECK` — taille mesurée et notée
      (plafonds : 368 Mo `catalogue-api`, 293 Mo `avis-api`)
- [ ] `.dockerignore` présent dans les deux services

**Swarm**
- [ ] `docker service ls` affiche **`3/3`** pour `catalogue-api` et `avis-api`
- [ ] `update_config` = `parallelism: 1`, `delay: 10s` présent dans `docker-stack.yml`
- [ ] Deux réseaux **overlay** déclarés et utilisés
- [ ] Bases inaccessibles depuis l'extérieur (aucun `ports:`)
- [ ] Secrets Docker utilisés, aucun mot de passe en clair
- [ ] Portainer accessible et affichant tous les services

**Tests**
- [ ] Suites unitaires et d'intégration vertes, aucun test désactivé
- [ ] Test de concurrence sur le stock : 5 succès / 5 × `409`
- [ ] `smoke-test.sh` vert contre la stack déployée
- [ ] `chaos-test.sh` exécuté, sortie horodatée conservée
- [ ] Test de charge exécuté, p95 relevé
- [ ] CI GitHub Actions verte

**Dépôt**
- [ ] Les quatre chemins exigés sont présents et correctement nommés
- [ ] `README.md` complet, commandes testées
- [ ] READMEs de service, spécification OpenAPI, `schema.graphql`, 3 ADR
- [ ] Aucun secret, aucun `node_modules`, aucun `dist` versionné
- [ ] Tag `v1.0.0`

**Compte-rendu PDF**
- [ ] Schéma d'architecture détaillé avec flux de données
- [ ] Justification écrite SQL vs NoSQL (arguments croisés, coûts assumés)
- [ ] Captures Portainer : services actifs, **3 replicas visibles**, nodes, logs
- [ ] Capture du rolling update montrant `parallelism: 1`
- [ ] Preuve de résilience : conteneur tué, application toujours disponible,
      reconvergence à `3/3`
- [ ] Résultats du test de montée en charge
- [ ] Tailles des images Docker documentées

**Contrôle final de conformité :** relire la section 0 et confirmer, une par
une, que les 12 règles inviolables sont respectées dans le code livré.
