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
