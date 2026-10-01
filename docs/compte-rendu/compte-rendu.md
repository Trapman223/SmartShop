# Smart-Shop — Plateforme de vente en ligne distribuée

**Compte-rendu de projet**
Examen de rattrapage — Développement d'applications distribuées

| | |
|---|---|
| **Étudiant** | _(à compléter)_ |
| **Formation / Groupe** | _(à compléter)_ |
| **Date** | 1er octobre 2026 |
| **Dépôt** | _(URL GitHub à compléter)_ |
| **Environnement de test** | Docker 29.8.1, Swarm mono-nœud `docker-desktop`, macOS |

---

## 1. Présentation

Smart-Shop est une plateforme e-commerce distribuée, composée de **deux
microservices indépendants** qui communiquent entre eux sur un réseau overlay,
déployés en **Docker Swarm** en mode Stack et supervisés par **Portainer**.

Chaque service possède sa propre responsabilité, sa propre pile technologique et
**sa propre base de données** — aucune des deux bases n'est accessible depuis
l'autre service, ni techniquement, ni par convention.

| | Service 1 | Service 2 |
|---|---|---|
| **Nom** | `service-catalogue-commandes` | `service-avis-recommandations` |
| **Responsabilité** | Catalogue produits et commandes clients | Avis, notes, historique, recommandations |
| **API exposée** | **REST** (port 3000) | **GraphQL** (port 4000) |
| **Base de données** | **PostgreSQL 16** | **MongoDB 7** |
| **Framework** | Express 5 | Apollo Server 4 sur Express 4 |
| **Accès données** | Prisma ORM | Mongoose ODM |
| **Replicas Swarm** | **3** | **3** |

L'ensemble tourne en **10 conteneurs** : 3 + 3 replicas d'API, 2 bases,
Portainer et son agent, plus un job éphémère de migration.

---

## 2. Architecture

### 2.1 Schéma général

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

### 2.2 Les quatre réseaux overlay

| Réseau | Type | Rattachés | Rôle |
|---|---|---|---|
| `smartshop-public` | overlay, `attachable` | les 2 API, Portainer | Trafic entrant et dialogue inter-API |
| `smartshop-pg` | overlay, **`internal`** | `catalogue-api`, `catalogue-migrate`, `postgres` | Accès à PostgreSQL |
| `smartshop-mongo` | overlay, **`internal`** | `avis-api`, `mongodb` | Accès à MongoDB |
| `portainer-agent` | overlay | Portainer et ses agents | Canal de supervision |

**Pourquoi deux réseaux de données plutôt qu'un seul ?** Avec un réseau
`smartshop-data` commun, `avis-api` pourrait techniquement ouvrir une connexion
vers PostgreSQL. La règle « une base par service » resterait alors purement
déclarative. En scindant, l'isolation devient **topologique** : le service d'avis
n'a aucune route réseau vers la base du catalogue.

Les deux réseaux de bases sont `internal: true` : ni PostgreSQL ni MongoDB ne
déclarent de bloc `ports:`, ils sont donc **injoignables depuis l'extérieur du
cluster**, y compris depuis la machine hôte.

### 2.3 Flux de données inter-services

Le sujet exige que les deux microservices communiquent entre eux. Le dialogue
est **bidirectionnel**.

#### Flux 1 — `avis-api` → `catalogue-api` (REST)

```
Client GraphQL                avis-api                      catalogue-api
     │                            │                               │
     │ { productsReviews {        │                               │
     │     items { product {      │                               │
     │       name price } } } }   │                               │
     ├───────────────────────────►│                               │
     │                            │ 1. MongoDB : lire les avis    │
     │                            │ 2. DataLoader accumule les    │
     │                            │    références produit du      │
     │                            │    tick courant               │
     │                            │                               │
     │                            │ GET /products/batch?refs=A,B  │
     │                            │ X-Request-Id: <trace>         │
     │                            ├──────────────────────────────►│
     │                            │                               │ PostgreSQL
     │                            │◄──────────────────────────────┤
     │                            │ { data: [ {...}, {...} ] }    │
     │◄───────────────────────────┤                               │
     │ réponse unique, enrichie   │                               │
```

Les champs `Review.product`, `Recommendation.product` et `ProductRating.product`
sont résolus à chaud. Le **batching par DataLoader** est ce qui évite le N+1 :
une page de 20 avis portant sur 12 produits distincts ne déclenche **qu'un seul**
appel HTTP, pas 20. Un test automatisé le vérifie explicitement.

#### Flux 2 — `catalogue-api` → `avis-api` (GraphQL)

```
Client REST                 catalogue-api                      avis-api
     │                            │                               │
     │ GET /products?limit=20     │                               │
     ├───────────────────────────►│                               │
     │                            │ 1. PostgreSQL : lire la page  │
     │                            │ 2. un seul appel pour toute   │
     │                            │    la page                    │
     │                            │                               │
     │                            │ POST /graphql                 │
     │                            │ productRatings(productIds:[…])│
     │                            │ X-Request-Id: <trace>         │
     │                            ├──────────────────────────────►│
     │                            │                               │ MongoDB
     │                            │◄──────────────────────────────┤
     │                            │ { data: { productRatings } }  │
     │◄───────────────────────────┤                               │
     │ chaque produit porte       │                               │
     │ "rating": {average, count} │                               │
```

#### Règles communes aux deux flux

| Règle | Mise en œuvre |
|---|---|
| **Adressage** | Par **nom de service Swarm** (`catalogue-api`, `avis-api`), jamais par IP ni `localhost`. Le DNS interne de Swarm équilibre sur les 3 replicas. |
| **Timeout** | **800 ms** via `AbortSignal.timeout`, sur chaque appel sortant. |
| **Mode dégradé** | Si l'amont ne répond pas, le champ vaut `null` et la réponse est servie quand même. |
| **Validation** | La réponse du service amont est validée par **zod**, comme toute entrée externe. |
| **Traçabilité** | `X-Request-Id` généré à l'entrée et propagé, pour corréler les logs des 6 replicas dans Portainer. |
| **Étanchéité** | Aucun service ne lit ni n'écrit dans la base de l'autre. |

#### Le mode dégradé, point central de la résilience

C'est la propriété la plus importante de cette architecture distribuée : **la
panne d'un service n'emporte pas l'autre**.

- Si `avis-api` tombe, `GET /products` répond toujours **`200`**, avec
  `"rating": null`. Le catalogue reste vendable.
- Si `catalogue-api` tombe, les requêtes GraphQL aboutissent toujours, avec
  `"product": null`. Les avis et les recommandations restent consultables.

Dans les deux cas, la dégradation est journalisée en `warn` avec le `traceId` :
elle est visible dans Portainer, elle n'est pas silencieuse. Quatre tests
automatisés protègent ce comportement contre une régression.

---

## 3. Justification du choix des bases de données

Le choix n'est pas esthétique : chaque service a une contrainte dominante
différente, et c'est elle qui décide.

### 3.1 PostgreSQL pour le catalogue et les commandes

La donnée est **relationnelle, régulière et critique**. Un produit, une commande,
des lignes de commande : trois entités au schéma stable, reliées par des clés
étrangères.

Surtout, l'opération centrale — passer une commande — exige d'écrire plusieurs
tables **de façon tout-ou-rien** : décrémenter le stock, créer la commande, créer
ses lignes, calculer le montant. Si l'une de ces écritures échoue, aucune ne doit
subsister.

Trois garanties pèsent ici :

1. **Transactions ACID multi-tables.** `POST /orders` s'exécute dans une seule
   transaction. `DELETE /orders/{id}` restitue le stock dans la même transaction
   que l'annulation — il n'existe aucun instant où la commande est annulée mais
   le stock non rendu.

2. **Verrou pessimiste.** Avec **3 replicas concurrents**, deux commandes
   simultanées liraient le même stock et le feraient passer sous zéro.
   `SELECT ... FOR UPDATE` (avec `ORDER BY id`, pour éviter les interblocages)
   sérialise l'accès à la ligne produit. Prisma n'exposant pas cette clause dans
   son API fluide, elle est émise via `$queryRaw` à l'intérieur d'un
   `$transaction`.

3. **Contraintes au niveau du moteur.** `CHECK (stock >= 0)`, clés étrangères,
   `UNIQUE` sur la référence produit. L'intégrité ne repose pas sur la discipline
   du code applicatif : la base **refuse elle-même** l'état invalide. La
   contrainte `CHECK` n'étant pas exprimable en Prisma, elle est posée par une
   migration SQL manuelle.

**Le coût assumé :** un schéma rigide, qui impose une migration pour toute
évolution, et un nœud unique (répliquer un conteneur PostgreSQL sur le même
volume corromprait les données).

### 3.2 MongoDB pour les avis et les recommandations

La donnée est **hétérogène, dénormalisée et sans contrainte transversale**.

Un avis est un document autonome : texte libre, note, tags en nombre variable,
historique d'édition imbriqué. Un événement de navigation porte des métadonnées
dont la **forme dépend du type d'événement** — un terme de recherche pour un
`SEARCH`, une quantité pour un `PURCHASE`, rien du tout pour un `VIEW`. Figer
cela en colonnes obligerait soit à des tables creuses, soit à une migration à
chaque nouveau signal.

Quatre raisons concrètes :

1. **Schéma flexible.** `metadata`, `tags` et `editHistory` sont déclarés libres
   (`Schema.Types.Mixed`) : ajouter un signal de recommandation ne demande
   **aucune migration**.

2. **Aucune transaction multi-documents nécessaire.** Poster un avis touche un
   seul document. Perdre la cohérence entre deux avis n'a pas de sens métier —
   contrairement à perdre la cohérence entre un stock et une commande.

3. **Agrégations natives.** Notes moyennes, répartition par étoile, tags les plus
   fréquents, scoring de recommandation : le **pipeline d'agrégation** calcule
   tout cela côté base, en un seul appel, sans remonter les documents.

4. **Volume et écriture.** L'historique de navigation croît vite et n'a pas
   besoin d'être conservé indéfiniment : un **index TTL** l'expire
   automatiquement, sans tâche de purge à écrire ni à superviser.

**Le coût assumé :** aucune garantie d'intégrité référentielle. Un avis peut
référencer une référence produit disparue du catalogue — c'est précisément
pourquoi `Review.product` est déclaré **nullable** dans le schéma GraphQL.

### 3.3 Synthèse

| Critère | PostgreSQL (catalogue) | MongoDB (avis) |
|---|---|---|
| Forme de la donnée | Régulière, relationnelle | Hétérogène, documentaire |
| Transaction multi-entités | **Indispensable** | Inutile |
| Concurrence sur une ressource rare | **Oui** (le stock) | Non |
| Évolution du schéma | Rare, par migration | Fréquente, sans migration |
| Coût d'une incohérence | Financier | Cosmétique |
| Lecture dominante | Point et filtre | Agrégation |

**En une phrase :** SQL là où une incohérence coûte de l'argent — stock,
commande, montant ; NoSQL là où la forme de la donnée change plus vite que le
schéma — texte libre, tags, signaux de navigation.

---

## 4. Orchestration Docker Swarm

### 4.1 Conformité aux contraintes du sujet

| Contrainte du sujet | Mise en œuvre | Vérification |
|---|---|---|
| Déploiement en mode **Stack** | `docker stack deploy -c docker-stack.yml smart-shop` | `docker stack services smart-shop` |
| **3 replicas** par API applicative | `deploy.replicas: 3` sur `catalogue-api` et `avis-api` | `3/3` dans `docker service ls` |
| `update_config` **parallelism = 1** | `deploy.update_config.parallelism: 1` | `docker service inspect` |
| `update_config` **delay = 10s** | `deploy.update_config.delay: 10s` | `docker service inspect` |
| Réseau **overlay** | 4 réseaux, tous `driver: overlay` | `docker network ls --filter driver=overlay` |
| **Portainer** dans la stack | `portainer-ce` + `portainer/agent` en `mode: global` | `https://localhost:9443` |
| Une image par service et par base | 3 images construites + `postgres:16-alpine` + `mongo:7` | `docker images` |

Sortie réelle au 01/10/2026 :

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

```
$ docker service inspect smart-shop_catalogue-api \
    --format 'parallelism={{.Spec.UpdateConfig.Parallelism}} delay={{.Spec.UpdateConfig.Delay}}'
parallelism=1 delay=10s
```

### 4.2 Décisions d'orchestration et leur justification

**Bases de données en 1 replica.** Le sujet n'exige 3 replicas que pour « les
deux API ». Répliquer un conteneur PostgreSQL ou MongoDB sur le **même volume**
corromprait les données : la haute disponibilité d'une base exige un véritable
cluster (réplication en flux, élection de primaire), hors périmètre du sujet. Un
`placement.constraints: [node.role == manager]` garantit en outre que la base
retrouve son volume après redémarrage.

**`order: start-first`.** Le nouveau conteneur doit devenir *healthy* **avant**
l'arrêt de l'ancien. Sans cela, `parallelism: 1` et `delay: 10s` espaceraient les
remplacements mais créeraient quand même une coupure à chaque étape. Pendant une
mise à jour, `docker service ls` affiche transitoirement `4/3` — c'est la preuve
visible que l'ancien replica sert encore pendant le démarrage du nouveau.

**`failure_action: rollback`.** Si un nouveau conteneur ne devient pas sain dans
la fenêtre `monitor: 30s`, Swarm ramène automatiquement la version précédente.

**Absence de `depends_on`.** Swarm l'ignore : l'ordre de démarrage ne se contrôle
pas. Chaque composant l'assume plutôt que de le supposer — le job de migration
réessaie `prisma migrate deploy` jusqu'à 30 fois, et chaque API applique un
backoff exponentiel à la connexion base. La sonde `/ready` renvoie `503` tant que
le schéma n'est pas prêt, ce qui empêche le routage mesh d'envoyer du trafic à un
replica non opérationnel.

**Un job de migration séparé.** `catalogue-migrate` apparaît en `0/1` : c'est
voulu. Avec `restart_policy: condition: none`, il applique les migrations, sort
en 0, et Swarm ne le relance pas. L'état `Complete` est visible dans
`docker service ps`.

### 4.3 Secrets

Aucun mot de passe n'apparaît dans `docker-stack.yml` ni dans le dépôt. Quatre
secrets Swarm — `pg_password`, `mongo_password`, `catalogue_database_url`,
`avis_mongodb_uri` — sont créés avant le déploiement par
`scripts/create-secrets.sh`, stockés **chiffrés dans le Raft** de Swarm et montés
en fichiers sous `/run/secrets/`. Les applications les lisent via les variables
`*_FILE`, résolues au démarrage.

---

## 5. Dockerisation et optimisation des images

Toutes les tailles sont **mesurées** avec `docker images`, jamais supposées.

### 5.1 Résultats

| Image | Avant | Après | Gain |
|---|---|---|---|
| `smartshop/catalogue-api` | 604 Mo | **368 Mo** | −39 % |
| `smartshop/catalogue-migrate` | 1,61 Go | **427 Mo** | **−73 %** |
| `smartshop/avis-api` | — | **293 Mo** | — |

L'image de base `node:22-alpine` pèse **238 Mo** à elle seule : la charge utile
réelle est donc de **130 Mo** pour le catalogue et **55 Mo** pour le service
d'avis.

### 5.2 Principes appliqués

- **Multi-stage** : `builder` (compilation TypeScript) → `deps`
  (`npm ci --omit=dev`) → `runner` (image finale). Ni code source, ni
  devDependencies, ni tests dans l'image livrée.
- **`npm ci`**, jamais `npm install` : build reproductible depuis le lockfile.
- **Ordre des couches** : `package*.json` copiés et installés **avant** `src/`,
  pour que la couche d'installation reste en cache.
- **`USER node`** : aucun conteneur applicatif ne tourne en root.
- **`tini` en PID 1** : garantit que `SIGTERM` atteint le process Node lors des
  rolling updates, condition nécessaire à l'arrêt propre.
- **`HEALTHCHECK`** sur `/health` : sans lui, `order: start-first` n'a aucun
  effet, car Swarm ne sait pas distinguer « démarré » de « prêt ».
- **Tags en version sémantique**, jamais `latest` : un `latest` rendrait le
  rolling update indéterministe.

### 5.3 Optimisation de `catalogue-api` : 604 → 368 Mo

`@prisma/engines` (35,6 Mo) contient le *schema-engine*, utilisé uniquement par
le CLI, et un **doublon** du query engine déjà présent dans `.prisma/client`. Par
ailleurs, le runtime de `@prisma/client` embarque les moteurs **WebAssembly** de
MySQL, SQLite, SQL Server et CockroachDB, alors que ce service ne parle qu'à
PostgreSQL, et via le moteur natif.

Les deux sont élagués **dans le stage `deps`** — jamais dans le `runner` : les
couches Docker étant **additives**, supprimer un fichier après le `COPY`
laisserait la couche d'origine intacte et n'allégerait rien.

S'y ajoute `--omit=peer` : `@prisma/client` déclare `prisma` (50 Mo) et
`typescript` (23 Mo) en peerDependencies **optionnelles**, que npm installe
malgré `--omit=dev`.

### 5.4 Optimisation de l'image de migration : 1,61 Go → 427 Mo

L'étage héritait de `builder` — 1,09 Go de devDependencies et de
`@prisma/client` — puis exécutait `chown -R node:node /app`. Or `chown -R`
réécrit chaque inode : Docker **dupliquait** les 360 Mo de `node_modules` dans
une couche supplémentaire. D'où 1,61 Go pour un job dont le seul travail est
d'exécuter `prisma migrate deploy`.

L'étage repart désormais de `node:22-alpine` et n'installe que le **CLI Prisma**,
à la version lue dans le lockfile, dans un dossier vierge. `@prisma/client`
(73,7 Mo) n'y entre pas : il sert à interroger la base, pas à la migrer.
L'appropriation des fichiers se fait via `COPY --chown`, qui n'ajoute aucune
couche.

### 5.5 Deux optimisations tentées, mesurées, puis écartées

Elles sont documentées ici parce qu'une optimisation refusée pour une raison
mesurée vaut mieux qu'une optimisation refaite par erreur plus tard.

**`--omit=peer` sur `avis-api`.** npm y retire `graphql`, pourtant dépendance
**directe**, et le conteneur meurt au démarrage sur
« Cannot find package 'graphql' ». Gain mesuré : 3 Mo. Abandonné.

**Suppression du query engine dans l'image de migration.** Le fichier
`libquery_engine-*.so.node` (17,5 Mo) fait doublon et aucune requête applicative
n'est exécutée par ce job. Mais le CLI Prisma le considère alors comme manquant
et tente de le **retélécharger** depuis `binaries.prisma.sh` au lancement.
Vérifié avec `docker run --network none` :

```
Error: request to https://binaries.prisma.sh/.../libquery_engine.so.node.gz.sha256
failed, reason: getaddrinfo EAI_AGAIN binaries.prisma.sh
```

Un service de la stack ne doit dépendre d'**aucun accès Internet** au démarrage.
Les 17,5 Mo sont conservés sciemment.

---

## 6. Monitoring — Portainer

Portainer CE est intégré à la stack, accompagné de son agent déployé en
`mode: global` — une tâche par nœud, présent et futur. L'agent est le **seul**
service autorisé à monter `/var/run/docker.sock`, et uniquement sur le nœud
manager ; aucun service applicatif n'y a accès.

Accès : `https://localhost:9443` (certificat auto-signé, avertissement à
accepter) ou `http://localhost:9000`.

### Captures à insérer

> **À faire avant l'envoi :** réaliser les captures ci-dessous depuis Portainer
> et les insérer à cet emplacement.

| # | Capture | Où la prendre | Ce qu'elle doit montrer |
|---|---|---|---|
| 1 | **Liste des services** | Swarm → Services | Les 7 services, et surtout **`3/3`** sur `catalogue-api` et `avis-api` |
| 2 | **Détail d'un service** | Services → `smart-shop_catalogue-api` | Les 3 tâches `Running`, l'image `1.1.0`, la configuration de mise à jour |
| 3 | **Vue des nœuds** | Swarm → Cluster / Nodes | Le nœud manager `Ready`, son état et ses ressources |
| 4 | **Logs en temps réel** | Services → un replica → Logs | Les logs JSON `pino`, avec un `traceId` visible |
| 5 | **Réseaux** | Networks | Les 4 réseaux overlay, dont les deux `internal` |
| 6 | **Pendant un rolling update** | Services, pendant `docker service update --force` | L'état transitoire **`4/3`**, preuve de `start-first` |

---

## 7. Tests

### 7.1 Suites unitaires — 215 tests, 100 % au vert

| Service | Tests | Périmètre |
|---|---|---|
| `service-catalogue-commandes` | **106** | Routes REST, validation, calcul de total, flux 2 et son mode dégradé |
| `service-avis-recommandations` | **109** | Queries et mutations GraphQL, scoring, flux 1, absence de N+1 |

`npm run lint` et `npm run typecheck` passent sans erreur sur les deux services.

Aucun test n'atteint le réseau : un fichier `tests/setup.ts` coupe `fetch` par
défaut. Sans ce garde-fou, les tests du flux 2 interrogeraient le vrai `avis-api`
— qui écoute sur le port 4000 dès que la stack tourne — et leur résultat
dépendrait de l'état du cluster.

### 7.2 Parcours fonctionnel contre la stack déployée

`./scripts/smoke-test.sh` exécute un parcours complet contre le cluster réel,
et non contre des mocks :

```
══ 1. Disponibilité des deux services ══
✓ catalogue-api /ready
✓ avis-api /ready
══ 2. Catalogue : création d'un produit (PostgreSQL) ══
✓ produit créé  (SS-SMOKE-…, stock 5)
══ 3. Commande : décrément transactionnel du stock ══
✓ commande créée, total calculé
✓ stock décrémenté 5 → 3
══ 4. Avis & recommandations (MongoDB) ══
✓ avis posté
✓ avis modifié (5 → 4)
✓ recommandations servies
══ 5. Flux 1 — avis-api interroge catalogue-api (REST) ══
✓ le produit remonte dans GraphQL
══ 6. Flux 2 — catalogue-api interroge avis-api (GraphQL) ══
✓ la note remonte dans GET /products
══ 7. Intégrité du stock sous concurrence (3 replicas) ══
✓ commandes acceptées (= stock disponible)
✓ commandes refusées en 409 (stock épuisé)
✓ stock jamais négatif
══ 8. Annulation : restitution transactionnelle du stock ══
✓ DELETE /orders/{id}
✓ stock restitué 0 → 2
══ Résultat ══
✓ parcours complet validé contre la stack Swarm
```

### 7.3 Montée en charge : intégrité du stock sous concurrence

**Protocole.** Un produit est créé avec un stock de 3. **10 commandes d'une unité
sont envoyées simultanément**, réparties par le routing mesh de Swarm sur les
**3 replicas** de `catalogue-api`, qui écrivent tous dans le même PostgreSQL.

**Résultat mesuré :**

| Mesure | Attendu | Obtenu |
|---|---|---|
| Commandes acceptées (`201`) | 3 | **3** |
| Commandes refusées (`409`) | 7 | **7** |
| Stock final | 0 | **0** |
| Stock jamais négatif | oui | **oui** |

**Interprétation.** C'est la preuve directe du `SELECT ... FOR UPDATE`. Sans
verrou pessimiste, plusieurs replicas liraient le même stock avant que l'un
d'eux ne l'écrive, et le stock passerait en négatif — ou la contrainte
`CHECK (stock >= 0)` ferait échouer les requêtes avec une erreur technique au
lieu d'un `409` métier propre. Les 7 refus sont des réponses **métier**, pas des
plantages.

---

## 8. Test de résilience

**Protocole.** L'API est sollicitée en continu (une requête toutes les 200 ms).
Au bout de 5 secondes, un conteneur est **supprimé brutalement** par
`docker rm -f`, sans prévenir Swarm. La sollicitation se poursuit 60 secondes au
total. Le script compte les échecs et observe la reconvergence.

Le **nombre de replicas n'est jamais modifié** : on tue une tâche, on ne réduit
pas le service.

**Résultats mesurés le 01/10/2026 :**

| Service visé | Requêtes | Succès | Échecs | Disponibilité | Reconvergence |
|---|---|---|---|---|---|
| `catalogue-api` | 217 | 217 | **0** | **100 %** | retour à `3/3`, aucune perte |
| `avis-api` | 232 | 232 | **0** | **100 %** | `2/3` → `3/3` en **~12 s** |

Extrait de la trace horodatée (`avis-api`) :

```
>>> 01:18:34  docker rm -f smart-shop_avis-api.3.4oeguun1lksjmei6nt470n8u2
>>> conteneur supprimé — Swarm doit maintenant replanifier la tâche

    01:18:34  t+05s  replicas=2/3  requetes=20  ok=20  ko=0
    01:18:38  t+09s  replicas=2/3  requetes=35  ok=35  ko=0
    01:18:44  t+15s  replicas=2/3  requetes=60  ok=60  ko=0
    01:18:46  t+17s  replicas=3/3  requetes=65  ok=65  ko=0
    01:18:50  t+20s  replicas=3/3  requetes=80  ok=80  ko=0

══ Bilan ══
  Requêtes émises        : 232
  Réponses 200           : 232
  Échecs                 : 0
  Disponibilité observée : 100.00 %
  Fenêtre d'indisponibilité : AUCUNE — pas une seule requête perdue
```

La trace montre nettement la fenêtre : `replicas=2/3` de t+05 s à t+15 s, retour
à `3/3` à t+17 s, **sans qu'une seule requête n'échoue**.

Le conteneur tué apparaît ensuite dans l'historique des tâches :

```
$ docker service ps smart-shop_catalogue-api
NAME                             CURRENT STATE            ERROR
smart-shop_catalogue-api.1       Running 44 seconds ago
 \_ smart-shop_catalogue-api.1   Failed 54 seconds ago    "task: non-zero exit (137)"
```

Le code **137** correspond à un `SIGKILL` — la suppression brutale — et Swarm a
replanifié la tâche automatiquement.

**Interprétation.** Deux mécanismes se combinent : le **routing mesh** de Swarm
écarte immédiatement la tâche morte du load balancing, de sorte que les deux
replicas survivants absorbent tout le trafic ; la **`restart_policy`** recrée
ensuite la tâche manquante. C'est exactement ce que le sujet demande de
démontrer.

> **Capture à insérer :** une copie d'écran de Portainer pendant l'incident,
> montrant le service passé à `2/3` puis revenu à `3/3`.

---

## 9. Conformité au barème

| Critère | Points | Éléments apportés |
|---|---|---|
| **Qualité des API (REST / GraphQL)** | 5 | REST : `GET /products`, `POST /orders`, `DELETE /orders/{id}` + CRUD complet, OpenAPI 3.1 servie sur `/docs`, erreurs RFC 7807 avec `traceId`. GraphQL : 8 queries, 4 mutations, schéma documenté, Apollo Sandbox. Architecture en couches, validation zod systématique. **Les deux flux inter-services**, avec batching DataLoader et mode dégradé. 215 tests. |
| **Gestion des données (SQL / NoSQL)** | 4 | PostgreSQL : transactions, `SELECT … FOR UPDATE` prouvé par test de concurrence, `CHECK (stock >= 0)`, clés étrangères, migrations versionnées. MongoDB : schéma flexible, index unique / texte / TTL, pipelines d'agrégation. Justification écrite avec coûts assumés (§ 3). |
| **Dockerisation & optimisation** | 3 | Multi-stage, non-root, `tini`, `HEALTHCHECK`, `.dockerignore`, tags sémantiques. Tailles **mesurées** : 368 / 293 / 427 Mo. Image de migration réduite de **−73 %**. Deux optimisations écartées, mesure à l'appui (§ 5.5). |
| **Orchestration Swarm** | 5 | Mode Stack, **3 replicas** sur les deux API, `parallelism: 1` / `delay: 10s`, `start-first`, rollback automatique, **4 réseaux overlay** dont 2 `internal`, secrets Swarm, limites de ressources, bases non exposées. Résilience vérifiée : **100 % de disponibilité**. |
| **Monitoring & clarté** | 3 | Portainer CE + agent `global` dans la stack, logs JSON `pino` corrélables par `X-Request-Id`. README complet aux commandes testées, ce compte-rendu, scripts de vérification reproductibles. |

---

## 10. Annexe — reproduire les résultats

```bash
# 1. Initialiser le Swarm et créer les secrets
docker swarm init
./scripts/create-secrets.sh

# 2. Construire les trois images
docker build -t smartshop/catalogue-api:1.1.0                      ./service-catalogue-commandes
docker build -t smartshop/catalogue-migrate:1.1.0 --target migrator ./service-catalogue-commandes
docker build -t smartshop/avis-api:1.1.0                            ./service-avis-recommandations

# 3. Déployer et vérifier
docker stack deploy -c docker-stack.yml smart-shop
docker stack services smart-shop          # attendu : 3/3 sur les deux API

# 4. Rejouer les preuves
./scripts/smoke-test.sh                   # parcours complet + concurrence
./scripts/chaos-test.sh catalogue         # résilience
./scripts/chaos-test.sh avis

# 5. Observer un rolling update
docker service update --force smart-shop_catalogue-api
watch -n 1 docker service ps smart-shop_catalogue-api
```

Les traces horodatées des tests de résilience sont déposées dans
`docs/compte-rendu/chaos-test-*.log`.
