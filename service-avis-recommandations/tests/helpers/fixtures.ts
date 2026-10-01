import DataLoader from 'dataloader';
import type { GraphQLContext } from '../../src/context.js';
import type { CatalogueProduct } from '../../src/clients/catalogue.client.js';

export const REVIEW_ID = '507f1f77bcf86cd799439011';
export const UNKNOWN_ID = '507f1f77bcf86cd799439099';
export const USER_ID = 'user-001';
export const PRODUCT_ID = 'SS-PRD-00001';

/** Imite un document Mongoose : `id` virtuel + champs du schéma. */
export function makeReviewDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: REVIEW_ID,
    userId: USER_ID,
    productId: PRODUCT_ID,
    rating: 5,
    comment: 'Excellent produit, livraison rapide.',
    tags: ['qualité', 'livraison'],
    createdAt: new Date('2026-03-01T10:00:00.000Z'),
    updatedAt: new Date('2026-03-01T10:00:00.000Z'),
    ...overrides,
  };
}

export function makeBrowsingEventDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: '507f1f77bcf86cd799439022',
    userId: USER_ID,
    productId: PRODUCT_ID,
    category: 'audio',
    eventType: 'VIEW',
    createdAt: new Date('2026-03-01T09:00:00.000Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
//  Contexte GraphQL de test (flux 1)
// ---------------------------------------------------------------------------

/** Produit tel que `catalogue-api` le renvoie sur `GET /products/batch`. */
export function makeCatalogueProduct(
  overrides: Partial<CatalogueProduct> = {},
): CatalogueProduct {
  return {
    id: 'dde74e41-0c50-40d6-9339-45a7ac167e17',
    reference: PRODUCT_ID,
    name: 'Casque audio sans fil',
    description: 'Réduction de bruit active, autonomie 30 h.',
    price: '149.90',
    stock: 12,
    available: true,
    ...overrides,
  };
}

/**
 * Contexte GraphQL complet pour les tests unitaires.
 *
 * Le loader du flux 1 est ici alimenté par une table en mémoire : aucun appel
 * HTTP réel n'est émis. Sans argument, toute référence résout à `null` —
 * c'est exactement le comportement attendu quand `catalogue-api` est
 * indisponible, ce qui laisse les tests existants inchangés dans leur intention.
 */
export function makeTestContext(
  products: ReadonlyMap<string, CatalogueProduct> = new Map(),
  traceId = 'test',
): GraphQLContext {
  return {
    traceId,
    customerId: undefined,
    loaders: {
      // Un vrai DataLoader, pas un stub : on vérifie ainsi le même chemin de
      // code qu'en production (regroupement, cache par requête), seule la
      // source de données change.
      product: new DataLoader<string, CatalogueProduct | null>((references) =>
        Promise.resolve(references.map((reference) => products.get(reference) ?? null)),
      ),
    },
  };
}
