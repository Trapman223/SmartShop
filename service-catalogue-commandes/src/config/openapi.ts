/**
 * Spécification OpenAPI 3.1 du service Catalogue & Commandes.
 *
 * Écrite en TypeScript plutôt qu'en YAML : aucune dépendance de parsing,
 * aucun fichier supplémentaire à copier dans l'image Docker, et les fautes
 * de frappe structurelles sont attrapées à la compilation.
 * Servie en JSON sur /openapi.json et explorable sur /docs.
 */

const problemDetails = {
  type: 'object',
  properties: {
    type: { type: 'string', format: 'uri' },
    title: { type: 'string' },
    status: { type: 'integer' },
    detail: { type: 'string' },
    instance: { type: 'string' },
    traceId: { type: 'string' },
    errors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string' },
          message: { type: 'string' },
        },
      },
    },
  },
  required: ['type', 'title', 'status', 'instance', 'traceId'],
} as const;

const productSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    reference: { type: 'string', example: 'SS-PRD-00123' },
    name: { type: 'string', example: 'Casque audio sans fil' },
    description: { type: ['string', 'null'] },
    price: {
      type: 'string',
      description:
        'Montant à deux décimales. Transmis en chaîne et non en nombre : un flottant IEEE-754 ne représente pas exactement les décimaux et fausserait les totaux.',
      example: '129.90',
    },
    stock: { type: 'integer', minimum: 0, example: 42 },
    available: { type: 'boolean', description: 'stock > 0' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const ratingSchema = {
  type: ['object', 'null'],
  description:
    "Note moyenne du produit, obtenue auprès d'avis-api (flux 2). Vaut null si le produit n'a aucun avis, ou si avis-api est indisponible : le catalogue reste alors servi en mode dégradé plutôt que de renvoyer une erreur.",
  properties: {
    average: { type: 'number', example: 4.5 },
    count: { type: 'integer', minimum: 0, example: 12 },
  },
} as const;

const productWithRatingSchema = {
  allOf: [
    productSchema,
    { type: 'object', properties: { rating: ratingSchema } },
  ],
} as const;

const orderSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    customerName: { type: 'string', example: 'Amina Diallo' },
    status: {
      type: 'string',
      enum: ['PENDING', 'CONFIRMED', 'SHIPPED', 'CANCELLED'],
    },
    total: { type: 'string', example: '259.80' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          productId: { type: 'string', format: 'uuid' },
          productReference: { type: ['string', 'null'] },
          productName: { type: ['string', 'null'] },
          quantity: { type: 'integer', minimum: 1 },
          unitPrice: { type: 'string', example: '129.90' },
          subtotal: { type: 'string', example: '259.80' },
        },
      },
    },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const paginationMeta = {
  type: 'object',
  properties: {
    page: { type: 'integer' },
    limit: { type: 'integer' },
    total: { type: 'integer' },
    totalPages: { type: 'integer' },
  },
} as const;

const idParam = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
} as const;

function problemResponse(description: string) {
  return {
    description,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ProblemDetails' } } },
  };
}

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Smart-Shop — Catalogue & Commandes',
    version: '1.0.0',
    description:
      'Service REST de gestion du catalogue produits et des commandes clients.\n\n' +
      "Toutes les erreurs suivent le format RFC 7807 (Problem Details) et portent un `traceId` permettant de retrouver la requête dans les logs, quel que soit le replica qui l'a traitée.\n\n" +
      '`POST /orders` et `DELETE /orders/{id}` sont transactionnels : vérification du stock, calcul du montant, écriture de la commande et mise à jour du stock se font dans une seule transaction PostgreSQL, sous verrou pessimiste.',
  },
  servers: [
    { url: 'http://localhost:3000', description: 'développement local' },
    { url: 'http://catalogue-api:3000', description: 'réseau overlay Swarm' },
  ],
  tags: [
    { name: 'Santé', description: 'Sondes de liveness et readiness' },
    { name: 'Produits', description: 'Catalogue' },
    { name: 'Commandes', description: 'Commandes clients' },
  ],
  components: {
    schemas: {
      Product: productSchema,
      ProductWithRating: productWithRatingSchema,
      Order: orderSchema,
      ProblemDetails: problemDetails,
      PaginationMeta: paginationMeta,
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['Santé'],
        summary: 'Liveness — le process répond',
        description: 'Cible du HEALTHCHECK Docker. Ne teste pas la base de données.',
        responses: { '200': { description: 'Service vivant' } },
      },
    },
    '/ready': {
      get: {
        tags: ['Santé'],
        summary: 'Readiness — PostgreSQL est joignable',
        responses: {
          '200': { description: 'Prêt à servir' },
          '503': { description: 'Base de données injoignable' },
        },
      },
    },
    '/products': {
      get: {
        tags: ['Produits'],
        summary: 'Lister les produits',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
          { name: 'q', in: 'query', description: 'Recherche sur nom, référence et description', schema: { type: 'string' } },
          { name: 'minPrice', in: 'query', schema: { type: 'string', example: '10.00' } },
          { name: 'maxPrice', in: 'query', schema: { type: 'string', example: '500.00' } },
          { name: 'inStock', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
          {
            name: 'sort',
            in: 'query',
            schema: {
              type: 'string',
              enum: ['price:asc', 'price:desc', 'name:asc', 'name:desc', 'createdAt:asc', 'createdAt:desc'],
              default: 'createdAt:desc',
            },
          },
        ],
        responses: {
          '200': {
            description:
              'Page de produits, chaque produit enrichi de sa note moyenne (flux 2 vers avis-api).',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/ProductWithRating' },
                    },
                    meta: { $ref: '#/components/schemas/PaginationMeta' },
                  },
                },
              },
            },
          },
          '400': problemResponse('Paramètres de requête invalides'),
        },
      },
      post: {
        tags: ['Produits'],
        summary: 'Créer un produit',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['reference', 'name', 'price', 'stock'],
                properties: {
                  reference: { type: 'string', example: 'SS-PRD-00123' },
                  name: { type: 'string', example: 'Casque audio sans fil' },
                  description: { type: 'string' },
                  price: { type: 'string', example: '129.90' },
                  stock: { type: 'integer', minimum: 0, example: 42 },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Produit créé',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Product' } } } } },
          },
          '400': problemResponse('Corps de requête invalide'),
          '409': problemResponse('Référence déjà utilisée'),
        },
      },
    },
    '/products/batch': {
      get: {
        tags: ['Produits'],
        summary: 'Résoudre plusieurs produits par référence',
        description:
          'Point de terminaison interne consommé par le service Avis & Recommandations pour résoudre les champs `Product` de son schéma GraphQL par lot (évite le N+1).',
        parameters: [
          { name: 'refs', in: 'query', required: true, schema: { type: 'string', example: 'SS-PRD-00123,SS-PRD-00124' } },
        ],
        responses: {
          '200': { description: 'Produits correspondants (les références inconnues sont omises)' },
          '400': problemResponse('Paramètre refs absent ou invalide'),
        },
      },
    },
    '/products/{id}': {
      get: {
        tags: ['Produits'],
        summary: 'Détail d’un produit',
        parameters: [idParam],
        responses: {
          '200': { description: 'Produit' },
          '400': problemResponse('Identifiant invalide'),
          '404': problemResponse('Produit introuvable'),
        },
      },
      put: {
        tags: ['Produits'],
        summary: 'Remplacer un produit',
        description: 'Sémantique PUT : remplacement complet. Un champ absent est réinitialisé, pas conservé.',
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['reference', 'name', 'price', 'stock'],
                properties: {
                  reference: { type: 'string' },
                  name: { type: 'string' },
                  description: { type: ['string', 'null'] },
                  price: { type: 'string' },
                  stock: { type: 'integer', minimum: 0 },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Produit remplacé' },
          '400': problemResponse('Corps ou identifiant invalide'),
          '404': problemResponse('Produit introuvable'),
          '409': problemResponse('Référence déjà utilisée par un autre produit'),
        },
      },
      delete: {
        tags: ['Produits'],
        summary: 'Supprimer un produit',
        parameters: [idParam],
        responses: {
          '204': { description: 'Produit supprimé' },
          '404': problemResponse('Produit introuvable'),
          '409': problemResponse('Produit référencé par des commandes'),
        },
      },
    },
    '/orders': {
      get: {
        tags: ['Commandes'],
        summary: 'Lister les commandes',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['PENDING', 'CONFIRMED', 'SHIPPED', 'CANCELLED'] } },
          { name: 'customerName', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Page de commandes' } },
      },
      post: {
        tags: ['Commandes'],
        summary: 'Créer une commande',
        description:
          'Opération transactionnelle en sept étapes : vérification de l’existence des produits, vérification du stock, calcul du montant, création de la commande, création des lignes, décrément du stock — le tout dans une transaction PostgreSQL sous `SELECT ... FOR UPDATE`.\n\n' +
          'Les lignes portant sur le même produit sont fusionnées avant traitement.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['customerName', 'items'],
                properties: {
                  customerName: { type: 'string', example: 'Amina Diallo' },
                  items: {
                    type: 'array',
                    minItems: 1,
                    items: {
                      type: 'object',
                      required: ['productId', 'quantity'],
                      properties: {
                        productId: { type: 'string', format: 'uuid' },
                        quantity: { type: 'integer', minimum: 1, example: 2 },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Commande créée, stock décrémenté',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Order' } } } } },
          },
          '400': problemResponse('Corps de requête invalide'),
          '404': problemResponse('Un des produits demandés n’existe pas'),
          '409': problemResponse('Stock insuffisant — le détail indique le produit et les quantités'),
        },
      },
    },
    '/orders/{id}': {
      get: {
        tags: ['Commandes'],
        summary: 'Détail d’une commande',
        parameters: [idParam],
        responses: {
          '200': { description: 'Commande' },
          '404': problemResponse('Commande introuvable'),
        },
      },
      delete: {
        tags: ['Commandes'],
        summary: 'Supprimer une commande',
        description:
          'Restitue le stock des lignes puis supprime la commande, dans une seule transaction. Une commande déjà expédiée est refusée (409). Une commande annulée a déjà rendu son stock : il n’est pas restitué deux fois.',
        parameters: [idParam],
        responses: {
          '204': { description: 'Commande supprimée, stock restitué' },
          '404': problemResponse('Commande introuvable'),
          '409': problemResponse('Commande déjà expédiée'),
        },
      },
    },
    '/orders/{id}/status': {
      patch: {
        tags: ['Commandes'],
        summary: 'Changer le statut d’une commande',
        description: 'Transitions autorisées : PENDING → CONFIRMED | CANCELLED, CONFIRMED → SHIPPED | CANCELLED. SHIPPED et CANCELLED sont terminaux.',
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: {
                  status: { type: 'string', enum: ['PENDING', 'CONFIRMED', 'SHIPPED', 'CANCELLED'] },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Statut mis à jour' },
          '404': problemResponse('Commande introuvable'),
          '409': problemResponse('Transition interdite'),
        },
      },
    },
  },
} as const;
