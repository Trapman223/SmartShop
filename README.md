# Smart-Shop — Plateforme de vente en ligne distribuée

Projet d'examen de rattrapage — **Développement d'applications distribuées**.

Architecture distribuée composée de **deux microservices indépendants**, chacun
avec sa propre responsabilité, sa propre pile technologique et sa propre base de
données, **communiquant entre eux** sur un réseau overlay, déployés en **Docker
Swarm** en mode Stack et supervisés par **Portainer**.

> **État : complet et déployé.** Stack vérifiée sur Docker 29.8.1 / Swarm
> mono-nœud le 01/10/2026 — les deux API en `3/3`, 215 tests unitaires verts,
> parcours fonctionnel et test de résilience exécutés contre le cluster réel.
> Les règles permanentes du projet sont dans [CLAUDE.md](CLAUDE.md).

---

## 1. Les deux microservices

| | `service-catalogue-commandes` | `service-avis-recommandations` |
|---|---|---|
| **Responsabilité** | Catalogue produits (référence, prix, stock) et commandes clients | Avis clients, notes produits, historique de navigation, recommandations temps réel |
| **API** | **REST** | **GraphQL** |
| **Base de données** | **PostgreSQL 16** (intégrité transactionnelle) | **MongoDB 7** (flexibilité du schéma) |
| **Runtime** | Node.js 22 + TypeScript 5.7 | Node.js 22 + TypeScript 5.7 |
| **Framework** | Express 5 | Apollo Server 4 (sur Express 4) |
| **Accès données** | Prisma ORM | Mongoose ODM |
| **Port** | `3000` | `4000` |
| **Replicas Swarm** | **3** | **3** |
| **Image** | `smartshop/catalogue-api:1.1.0` — 368 Mo | `smartshop/avis-api:1.1.0` — 293 Mo |

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
          │  catalogue-api   │──┤    avis-api      │  │  Portainer  │
          │   3 replicas     │  │   3 replicas     │  │  CE + agent │
          │  REST / Express  ├──│ GraphQL / Apollo │  │  (global)   │
          └───────────┬──────┘  └────┬─────────────┘  └──┬──────────┘
                      │              │                   │
   ═ overlay ═════════▼═══════╗  ╔═══▼════════════════╗  │ docker.sock
   « smartshop-pg » internal  ║  ║ « smartshop-mongo »║  │ (manager)
                  ┌───────────▼┐ ║ internal  ┌────────▼┐ │
                  │ PostgreSQL │ ╚═══════════│ MongoDB │ │
                  │ 1 replica  │             │1 replica│ │
                  │   pgdata   │             │mongodata│ │
                  └────────────┘             └─────────┘ │
                                                         │
                     ┌───────────────────────────────────▼─┐
                     │  overlay « portainer-agent »        │
                     └─────────────────────────────────────┘
```

**Quatre réseaux overlay.** `smartshop-public` porte le trafic entrant et le
dialogue entre les deux API. `smartshop-pg` et `smartshop-mongo` sont déclarés
`internal: true` : chaque base n'est joignable que par son propre service, et
depuis nulle part ailleurs — pas même depuis l'autre microservice.

### Les deux flux de communication inter-services

Le sujet exige que les deux services communiquent entre eux. Le dialogue est
**bidirectionnel**, et chaque sens est protégé contre la panne de l'autre.

**Flux 1 — `avis-api` → `catalogue-api` (REST).**
Les champs `Product` des types GraphQL (`Review.product`,
`Recommendation.product`, `ProductRating.product`) sont résolus en appelant
`GET http://catalogue-api:3000/products/batch?refs=...`. Le batching passe par
**DataLoader** : une page de 20 avis portant sur 12 produits distincts ne
déclenche **qu'un seul** appel HTTP, jamais 20.

**Flux 2 — `catalogue-api` → `avis-api` (GraphQL).**
`GET /products` enrichit chaque produit de sa note moyenne via la query
`productRatings(productIds: [...])` — un seul appel pour toute la page.

**Règles communes aux deux flux :**

- adressage par **nom de service Swarm** (`catalogue-api`, `avis-api`), jamais
  par IP ni par `localhost` : le DNS interne équilibre sur les 3 replicas ;
- **timeout 800 ms** sur chaque appel sortant (`AbortSignal.timeout`) ;
- **mode dégradé** : si le service amont ne répond pas, le champ vaut `null` et
  la réponse est servie quand même. Le catalogue reste disponible si `avis-api`
  tombe, et réciproquement ;
- la réponse amont est **validée par zod** comme n'importe quelle entrée
  externe ;
- l'en-tête `X-Request-Id` est propagé, pour que les logs des 6 replicas soient
  corrélables dans Portainer ;
- aucun service ne lit la base de l'autre. **Une base par service, sans
  exception.**

---

## 3. Prérequis

| Outil | Version minimale | Vérification |
|---|---|---|
| Docker Engine | 24+ | `docker -v` |
| Docker Compose | v2 | `docker compose version` |
| Node.js | 22 LTS | `node -v` *(développement local uniquement)* |
| npm | 10+ | `npm -v` *(développement local uniquement)* |

**Ports utilisés :** `3000` (REST), `4000` (GraphQL), `9000` / `9443`
(Portainer). PostgreSQL et MongoDB n'exposent **aucun** port — ils ne sont
joignables que depuis leur réseau overlay interne.

```bash
lsof -nP -iTCP:3000 -iTCP:4000 -iTCP:9443 -sTCP:LISTEN   # doit être vide
```

**Ressources Docker :** allouer au minimum **6 Go de RAM**. La stack fait
tourner 10 conteneurs : 3 + 3 replicas d'API, 2 bases, Portainer et son agent.

---

## 4. Initialiser le Swarm

```bash
docker swarm init
docker node ls
```

Sortie attendue — le nœud doit être `Ready` et `Leader` :

```
ID                            HOSTNAME         STATUS    AVAILABILITY   MANAGER STATUS
5kophpndjmv1k0kruaoygoq4t *   docker-desktop   Ready     Active         Leader
```

---

## 5. Créer les secrets

Aucun mot de passe n'est versionné : le script en génère d'aléatoires et les
confie au Raft chiffré de Swarm, d'où ils sont montés en fichiers sous
`/run/secrets/`.

```bash
./scripts/create-secrets.sh
docker secret ls
```

Quatre secrets sont créés : `pg_password`, `mongo_password`,
`catalogue_database_url`, `avis_mongodb_uri`.

> Les secrets Swarm sont **immuables**. Pour changer un mot de passe, il faut
> retirer la stack, supprimer le secret, le recréer, puis redéployer.

---

## 6. Construire les trois images

```bash
docker build -t smartshop/catalogue-api:1.1.0                        ./service-catalogue-commandes
docker build -t smartshop/catalogue-migrate:1.1.0 --target migrator   ./service-catalogue-commandes
docker build -t smartshop/avis-api:1.1.0                              ./service-avis-recommandations

docker images --format '{{.Repository}}:{{.Tag}}\t{{.Size}}' | grep smartshop
```

Tailles attendues, **mesurées** le 01/10/2026 :

| Image | Taille | Rôle |
|---|---|---|
| `smartshop/catalogue-api:1.1.0` | **368 Mo** | API REST (sans le CLI Prisma) |
| `smartshop/avis-api:1.1.0` | **293 Mo** | API GraphQL |
| `smartshop/catalogue-migrate:1.1.0` | **427 Mo** | Job éphémère de migration |

L'image de base `node:22-alpine` pèse à elle seule **238 Mo** : la charge utile
réelle est donc de 130 Mo et 55 Mo pour les deux API. Voir
[§ 14](#14-optimisation-des-images) pour le détail des optimisations.

---

## 7. Lancer la Stack

```bash
docker stack config -c docker-stack.yml > /dev/null   # validation syntaxique
docker stack deploy -c docker-stack.yml smart-shop
```

Chaîne de démarrage : `postgres → catalogue-migrate → catalogue-api ×3`.

> `depends_on` n'existe pas en Swarm : l'ordre de démarrage ne se contrôle pas.
> Chaque service l'assume — le job de migration réessaie jusqu'à ce que
> PostgreSQL réponde, et les API appliquent un backoff exponentiel à la
> connexion base.

---

## 8. Vérifier le déploiement

```bash
docker stack services smart-shop
```

Sortie attendue, après une vingtaine de secondes :

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

> **`catalogue-migrate` affiche `0/1` : c'est normal.** C'est un travail
> ponctuel (`restart_policy: condition: none`) : il applique les migrations,
> sort en 0, et Swarm ne le relance pas. `docker service ps` le montre en
> état `Complete`.

Vérifier la stratégie de mise à jour réellement appliquée :

```bash
docker service inspect smart-shop_catalogue-api \
  --format 'parallelism={{.Spec.UpdateConfig.Parallelism}} delay={{.Spec.UpdateConfig.Delay}}'
# parallelism=1 delay=10s
```

Vérifier les migrations et la santé :

```bash
docker service logs smart-shop_catalogue-migrate | tail -5
# No pending migrations to apply.
# migrate: terminé avec succès (tentative 1)

curl -s http://localhost:3000/ready
# {"status":"ready","checks":{"postgresql":"up","schema":"ready"}, ...}

curl -s http://localhost:4000/ready
# {"status":"ready","checks":{"mongodb":"up"}, ...}
```

---

## 9. Accès aux interfaces

| Interface | URL | Note |
|---|---|---|
| **Portainer** | `https://localhost:9443` (ou `http://localhost:9000`) | Créer le compte admin au premier accès ; certificat auto-signé, avertissement à accepter. Choisir l'environnement **Docker Swarm**. |
| **Swagger UI** (OpenAPI 3.1) | `http://localhost:3000/docs` | Documentation interactive de l'API REST |
| **Apollo Sandbox** | `http://localhost:4000/graphql` | Exploration du schéma GraphQL, introspection activée |

L'agent Portainer tourne en `mode: global` — une tâche par nœud — ce qui donne
la vue sur tous les services, tous les nœuds et les logs en temps réel. C'est le
**seul** service autorisé à monter le socket Docker.

---

## 10. Exemples d'utilisation

Commandes copiables-collables, **toutes testées** contre la stack déployée.

### 10.1 API REST — catalogue et commandes

```bash
# Créer un produit
curl -s -X POST http://localhost:3000/products \
  -H 'content-type: application/json' \
  -d '{"reference":"SS-PRD-00042","name":"Casque audio sans fil","price":"149.90","stock":25}'

# Lister le catalogue — chaque produit porte sa note moyenne (flux 2)
curl -s 'http://localhost:3000/products?limit=5'
```

```jsonc
{
  "data": [
    {
      "reference": "SS-PRD-00042",
      "name": "Casque audio sans fil",
      "price": "149.90",
      "stock": 25,
      "available": true,
      "rating": { "average": 4.5, "count": 2 }   // ← vient d'avis-api
    }
  ],
  "meta": { "page": 1, "limit": 5, "total": 1, "totalPages": 1 }
}
```

```bash
# Passer une commande — transactionnelle, avec verrou sur le stock
curl -s -X POST http://localhost:3000/orders \
  -H 'content-type: application/json' \
  -d '{"customerName":"Amina Diallo","items":[{"productId":"<uuid-produit>","quantity":2}]}'

# Annuler une commande — restitue le stock dans la même transaction
curl -s -o /dev/null -w '%{http_code}\n' \
  -X DELETE http://localhost:3000/orders/<uuid-commande>     # 204
```

> Les montants transitent en **chaîne** (`"149.90"`), jamais en flottant : un
> `double` IEEE-754 ne représente pas exactement les décimaux et fausserait les
> totaux.

### 10.2 API GraphQL — avis et recommandations

```bash
# Poster un avis
curl -s -X POST http://localhost:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"mutation{createReview(input:{userId:\"u1\",productId:\"SS-PRD-00042\",rating:5,comment:\"Excellent produit.\",tags:[\"qualite\"]}){id rating}}"}'

# Modifier un avis
curl -s -X POST http://localhost:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"mutation{updateReview(id:\"<id-avis>\",input:{rating:4}){id rating}}"}'

# Avis d'un produit, enrichis du produit lui-même (flux 1)
curl -s -X POST http://localhost:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"{productsReviews(productId:\"SS-PRD-00042\"){total items{rating comment product{reference name price stock}}}}"}'

# Recommandations personnalisées, déterministes et explicables
curl -s -X POST http://localhost:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"{recommendations(userId:\"u1\",limit:5){productId score reason explanation product{name}}}"}'

# Historique de navigation
curl -s -X POST http://localhost:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"{browsingHistory(userId:\"u1\",limit:10){productId category eventType createdAt}}"}'
```

---

## 11. Tests

### 11.1 Suites unitaires — 215 tests

```bash
(cd service-catalogue-commandes && npm ci && npm run lint && npm run typecheck && npm test)
(cd service-avis-recommandations && npm ci && npm run lint && npm run typecheck && npm test)
```

| Service | Tests | Couvre notamment |
|---|---|---|
| `service-catalogue-commandes` | **106** | routes REST, validation, calcul de total, flux 2 et son mode dégradé |
| `service-avis-recommandations` | **109** | queries et mutations GraphQL, scoring, flux 1, absence de N+1 |

Aucun test n'atteint le réseau : `tests/setup.ts` coupe `fetch` par défaut, car
`avis-api` écoute sur le port 4000 dès que la stack tourne et les tests
cesseraient d'être déterministes.

### 11.2 Parcours fonctionnel contre la stack déployée

```bash
./scripts/smoke-test.sh
```

Vérifie, sur le cluster réel : les deux API, le parcours produit → commande →
stock → avis → recommandations → annulation → restitution, **les deux flux
inter-services**, et l'intégrité du stock sous concurrence.

**Test de concurrence** (inclus) : 10 commandes simultanées sur un stock de 3,
réparties sur les 3 replicas, produisent **exactement 3 succès et 7 réponses
`409`**, et le stock ne descend jamais sous zéro. C'est la preuve directe du
`SELECT ... FOR UPDATE` : sans verrou pessimiste, plusieurs replicas liraient le
même stock et le feraient passer en négatif.

### 11.3 Test de résilience

```bash
./scripts/chaos-test.sh catalogue      # ou : avis
```

Voir [§ 13](#13-test-de-résilience).

---

## 12. Rolling update — observer `parallelism: 1` et `delay: 10s`

```bash
docker service update --force smart-shop_catalogue-api
watch -n 1 docker service ps smart-shop_catalogue-api
```

Les replicas sont remplacés **un par un**, avec **10 secondes** entre chacun.
`order: start-first` fait démarrer le nouveau conteneur et attend qu'il soit
`healthy` **avant** d'arrêter l'ancien : pendant la bascule, `docker service ls`
affiche transitoirement `4/3`, et **aucune requête n'est perdue**.

`failure_action: rollback` ramène automatiquement la version précédente si un
nouveau conteneur ne devient pas sain.

---

## 13. Test de résilience

Exigé par le sujet : prouver que l'application reste disponible après la
suppression manuelle d'un conteneur.

```bash
./scripts/chaos-test.sh catalogue
```

Le script sollicite l'API en continu, supprime brutalement un conteneur
(`docker rm -f`) au bout de 5 secondes, et mesure. **Le nombre de replicas n'est
jamais modifié** : on tue une tâche, on ne réduit pas le service.

**Résultats mesurés le 01/10/2026 :**

| Service visé | Requêtes | Succès | Échecs | Disponibilité | Reconvergence |
|---|---|---|---|---|---|
| `catalogue-api` | 217 | 217 | **0** | **100 %** | retour à `3/3` sans perte |
| `avis-api` | 232 | 232 | **0** | **100 %** | `2/3` → `3/3` en **~12 s** |

Extrait de la trace horodatée (`avis-api`) :

```
>>> 01:18:34  docker rm -f smart-shop_avis-api.3.4oeguun1lksjmei6nt470n8u2
    01:18:34  t+05s  replicas=2/3  requetes=20  ok=20  ko=0
    01:18:44  t+15s  replicas=2/3  requetes=60  ok=60  ko=0
    01:18:46  t+17s  replicas=3/3  requetes=65  ok=65  ko=0
```

Les deux replicas survivants absorbent tout le trafic pendant que Swarm
replanifie la tâche : c'est le **routing mesh** de Swarm qui écarte
automatiquement la tâche morte du load balancing, et la `restart_policy` qui la
recrée.

Vérification manuelle équivalente :

```bash
docker ps --filter name=smart-shop_catalogue-api --format '{{.ID}} {{.Names}}'
docker rm -f <ID_DU_CONTENEUR>
watch -n 1 docker service ls --filter name=smart-shop_catalogue-api
```

---

## 14. Optimisation des images

Toutes les tailles sont **mesurées** (`docker images`), jamais supposées.

| Image | Avant | Après | Gain |
|---|---|---|---|
| `catalogue-api` | 604 Mo | **368 Mo** | −39 % |
| `catalogue-migrate` | 1,61 Go | **427 Mo** | **−73 %** |
| `avis-api` | — | **293 Mo** | — |

**Dockerfiles multi-stage** : `builder` (compilation TypeScript) → `deps`
(`npm ci --omit=dev`) → `runner` (image finale). Ni code source, ni
devDependencies, ni tests dans l'image finale. `USER node`, `tini` en PID 1,
`HEALTHCHECK` sur `/health`.

**`catalogue-api` : 604 → 368 Mo.** `@prisma/engines` (35,6 Mo) contient le
schema-engine, utilisé seulement par le CLI, et un doublon du query engine. Le
runtime de `@prisma/client` embarque par ailleurs les moteurs WebAssembly de
MySQL, SQLite, SQL Server et CockroachDB, alors que ce service ne parle qu'à
PostgreSQL, via le moteur natif. Les deux sont élagués **dans le stage `deps`**
— jamais dans le `runner` : les couches Docker étant additives, supprimer après
le `COPY` n'allégerait rien. S'y ajoute `--omit=peer`, car `@prisma/client`
déclare `prisma` (50 Mo) et `typescript` (23 Mo) en peers **optionnels**, que
npm installe malgré `--omit=dev`.

**`catalogue-migrate` : 1,61 Go → 427 Mo.** L'étage héritait de `builder` puis
faisait `chown -R node:node /app`, ce qui dupliquait les 360 Mo de
`node_modules` dans une couche supplémentaire. Il repart désormais de
`node:22-alpine` et n'installe que le CLI Prisma, à la version lue dans le
lockfile. `@prisma/client` (73,7 Mo) n'y entre pas : il sert à interroger la
base, pas à la migrer.

> **Deux optimisations tentées puis écartées, car mesurées :**
> `--omit=peer` sur `avis-api` retire `graphql`, pourtant dépendance directe, et
> le conteneur meurt sur « Cannot find package 'graphql' » — gain de 3 Mo, donc
> abandonné. Et supprimer le query engine de l'image de migration fait
> **retélécharger** Prisma depuis `binaries.prisma.sh` au lancement : vérifié
> avec `docker run --network none`, la migration échoue alors sur
> `getaddrinfo EAI_AGAIN`. Un service de la stack ne doit dépendre d'aucun accès
> Internet au démarrage : les 17,5 Mo sont conservés sciemment.

---

## 15. Pourquoi SQL d'un côté et NoSQL de l'autre

Le choix n'est pas esthétique : chaque service a une contrainte dominante
différente, et c'est elle qui décide.

### PostgreSQL pour le catalogue et les commandes

La donnée est **relationnelle, régulière et critique**. Un produit, une
commande, des lignes de commande : trois entités au schéma stable, reliées par
des clés étrangères. Surtout, l'opération centrale — passer une commande —
exige d'écrire plusieurs tables **de façon tout-ou-rien** : décrémenter le
stock, créer la commande, créer ses lignes, calculer le montant. Si l'une de
ces écritures échoue, aucune ne doit subsister.

Trois garanties pèsent ici, qu'un moteur documentaire ne fournit pas aussi
simplement :

1. **Transactions ACID multi-tables.** `POST /orders` s'exécute dans une seule
   transaction. `DELETE /orders/{id}` restitue le stock dans la même
   transaction que l'annulation.
2. **Verrou pessimiste.** Avec 3 replicas concurrents, deux commandes simultanées
   liraient le même stock. `SELECT ... FOR UPDATE` (avec `ORDER BY id` pour
   éviter les interblocages) sérialise l'accès. Le test de concurrence le
   prouve : 10 commandes simultanées sur un stock de 3 donnent exactement
   3 succès et 7 refus.
3. **Contraintes au niveau du moteur.** `CHECK (stock >= 0)`, clés étrangères,
   `UNIQUE` sur la référence produit. L'intégrité ne repose pas sur la
   discipline du code applicatif : la base refuse elle-même l'état invalide.

Le prix assumé : un schéma rigide, qui impose une migration pour toute
évolution.

### MongoDB pour les avis et les recommandations

La donnée est **hétérogène, dénormalisée et sans contrainte transversale**. Un
avis est un document autonome : texte libre, note, tags en nombre variable,
historique d'édition imbriqué. Un événement de navigation porte des métadonnées
dont la forme dépend du type d'événement — un terme de recherche pour un
`SEARCH`, une quantité pour un `PURCHASE`. Figer cela en colonnes obligerait
soit à des tables creuses, soit à une migration à chaque nouveau signal.

Quatre raisons concrètes :

1. **Schéma flexible.** `metadata`, `tags` et `editHistory` sont libres
   (`Schema.Types.Mixed`) : ajouter un signal de recommandation ne demande
   aucune migration.
2. **Aucune transaction multi-documents nécessaire.** Poster un avis touche un
   seul document. Perdre la cohérence entre deux avis n'a pas de sens métier —
   contrairement à perdre la cohérence entre un stock et une commande.
3. **Agrégations natives.** Notes moyennes, répartition par étoile, tags les
   plus fréquents, scoring de recommandation : le pipeline d'agrégation calcule
   tout cela côté base, en un appel.
4. **Volume et écriture.** L'historique de navigation croît vite et n'a pas
   besoin d'être conservé indéfiniment : un index **TTL** l'expire
   automatiquement, sans tâche de purge.

Le prix assumé : aucune garantie d'intégrité référentielle. Un avis peut
référencer une référence produit disparue du catalogue — c'est précisément
pourquoi `Review.product` est **nullable**.

### En une phrase

**SQL là où une incohérence coûte de l'argent** (stock, commande, montant) ;
**NoSQL là où la forme de la donnée change plus vite que le schéma** (texte
libre, tags, signaux de navigation).

---

## 16. Compte-rendu

Le compte-rendu détaillé — schéma d'architecture et flux de données,
justification SQL vs NoSQL, mesures d'optimisation des images, résultats
chiffrés des tests de concurrence et de résilience — vit dans
[`docs/compte-rendu/compte-rendu.md`](docs/compte-rendu/compte-rendu.md).

Pour produire le PDF à envoyer :

```bash
python3 scripts/build-compte-rendu.py
open docs/compte-rendu/compte-rendu.html
# puis Cmd+P → « Enregistrer au format PDF »
```

Le script n'a **aucune dépendance** : ni pandoc, ni npm, ni pip. Le HTML produit
est régénérable à volonté et n'est donc pas versionné.

> Les captures d'écran Portainer restent à insérer : le compte-rendu indique
> précisément lesquelles prendre et à quel endroit (§ 6).

---

## 17. Structure du dépôt

```
SmartShop/
├── CLAUDE.md                          Règles permanentes du projet
├── README.md                          Ce fichier
├── docker-stack.yml                   Déploiement Swarm (à la racine)
├── docker-compose.dev.yml             Vérification locale des images
├── scripts/
│   ├── create-secrets.sh              Génère les 4 secrets Swarm
│   ├── verify-containers.sh           Contrôle de la conteneurisation
│   ├── smoke-test.sh                  Parcours fonctionnel + concurrence
│   └── chaos-test.sh                  Test de résilience (livrable)
│
├── service-catalogue-commandes/       REST + PostgreSQL + Prisma
│   ├── Dockerfile  .dockerignore  .env.example
│   ├── prisma/schema.prisma           Product, Order, OrderItem
│   ├── prisma/migrations/             dont la contrainte CHECK stock >= 0
│   ├── src/
│   │   ├── server.ts                  Bootstrap + arrêt propre (SIGTERM)
│   │   ├── app.ts                     Montage Express
│   │   ├── config/env.ts              Variables validées par zod
│   │   ├── config/openapi.ts          Spécification OpenAPI 3.1 (/docs)
│   │   ├── clients/avis.client.ts     ◄── FLUX 2 vers avis-api
│   │   ├── routes/ controllers/ services/ repositories/
│   │   ├── validators/ utils/ errors/ middlewares/ lib/
│   └── tests/{unit,helpers}/          106 tests
│
└── service-avis-recommandations/      GraphQL + MongoDB + Mongoose
    ├── Dockerfile  .dockerignore  .env.example
    ├── src/
    │   ├── server.ts  app.ts  context.ts
    │   ├── graphql/typeDefs.ts        Schéma GraphQL
    │   ├── clients/catalogue.client.ts ◄── FLUX 1 vers catalogue-api
    │   ├── clients/product.loader.ts   ◄── DataLoader (anti N+1)
    │   ├── resolvers/ services/ repositories/ models/
    │   ├── validators/ utils/ errors/ middlewares/ lib/
    └── tests/{unit,helpers}/          109 tests
```

---

## 18. Développement local

Chaque service est autonome. Depuis son dossier :

```bash
cd service-catalogue-commandes      # ou service-avis-recommandations

cp .env.example .env                # puis renseigner les valeurs locales
npm install

npm run dev                         # démarrage en watch (tsx)
npm run build                       # compilation TypeScript → dist/
npm test                            # suite de tests (vitest)
npm run lint                        # ESLint
npm run typecheck                   # vérification de types sans émission
```

Pour faire tourner les deux bases en local sans Swarm :

```bash
docker compose -f docker-compose.dev.yml up -d
```

> `.env` ne doit **jamais** être committé. Seul `.env.example` est versionné,
> avec des valeurs factices. `docker-compose.dev.yml` sert au confort de
> développement et **ne remplace jamais** la stack Swarm du rendu.

---

## 19. Arrêt et nettoyage

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

## 20. Dépannage

| Symptôme | Cause probable | Correction |
|---|---|---|
| API bloquée en `0/3` | Image absente ou variable manquante | `docker service ps <svc> --no-trunc` puis `docker service logs <svc>` |
| `/ready` → `{"schema":"pending"}` | Migrations non appliquées | `docker service logs smart-shop_catalogue-migrate` |
| `catalogue-migrate` en `0/1` | **Normal** : travail ponctuel terminé | Vérifier `Complete` dans `docker service ps` |
| `rating` toujours `null` dans `GET /products` | `avis-api` injoignable — mode dégradé | `docker service ps smart-shop_avis-api` ; chercher `flux 2 dégradé` dans les logs du catalogue |
| `product` toujours `null` en GraphQL | `catalogue-api` injoignable — mode dégradé | chercher `flux 1 dégradé` dans les logs d'`avis-api` |
| `port already in use` | Un service natif occupe le port | `lsof -nP -iTCP:3000 -sTCP:LISTEN` |
| Tâches en `Rejected` | Image introuvable par le nœud | En multi-nœuds, un registre local est nécessaire |
| Secret modifié sans effet | Les secrets Swarm sont **immuables** | `docker stack rm`, `docker secret rm`, recréer, redéployer |
| Avertissement « could not be accessed on a registry » | Images construites localement, non poussées | Sans effet en mono-nœud ; en multi-nœuds, utiliser un registre |

---

## Licence

Projet académique — usage pédagogique.
