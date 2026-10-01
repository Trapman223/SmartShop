import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { makeBrowsingEventDocument, USER_ID, makeTestContext } from '../helpers/fixtures.js';

const reviewRepo = {
  findPage: vi.fn(),
  findById: vi.fn(),
  findByUserAndProduct: vi.fn(),
  create: vi.fn(),
  updateById: vi.fn(),
  deleteById: vi.fn(),
  findReviewedProductIds: vi.fn().mockResolvedValue([]),
  aggregateRatings: vi.fn().mockResolvedValue([]),
  aggregateTopTags: vi.fn().mockResolvedValue([]),
};
const browsingRepo = {
  create: vi.fn(),
  findByUser: vi.fn().mockResolvedValue([]),
  aggregateCategoryCounts: vi.fn().mockResolvedValue([]),
  findViewedProductIds: vi.fn().mockResolvedValue([]),
  findPurchasedProductIds: vi.fn().mockResolvedValue([]),
  aggregateCoViewedProducts: vi.fn().mockResolvedValue([]),
  findProductCategories: vi.fn().mockResolvedValue([]),
};
vi.mock('../../src/repositories/review.repository.js', () => reviewRepo);
vi.mock('../../src/repositories/browsingEvent.repository.js', () => browsingRepo);
vi.mock('../../src/db/mongoose.js', () => ({
  connectWithRetry: vi.fn(),
  disconnectMongoose: vi.fn(),
  isDatabaseReachable: vi.fn().mockReturnValue(true),
}));

const { createApolloServer } = await import('../../src/app.js');
const apollo = createApolloServer();

async function run(query: string, variables?: Record<string, unknown>) {
  const response = await apollo.executeOperation(
    { query, ...(variables !== undefined ? { variables } : {}) },
    { contextValue: makeTestContext() },
  );
  if (response.body.kind !== 'single') throw new Error('réponse inattendue');
  return response.body.singleResult;
}

beforeEach(() => {
  vi.clearAllMocks();
  reviewRepo.findReviewedProductIds.mockResolvedValue([]);
  reviewRepo.aggregateRatings.mockResolvedValue([]);
  browsingRepo.aggregateCategoryCounts.mockResolvedValue([]);
  browsingRepo.findViewedProductIds.mockResolvedValue([]);
  browsingRepo.findPurchasedProductIds.mockResolvedValue([]);
  browsingRepo.aggregateCoViewedProducts.mockResolvedValue([]);
  browsingRepo.findProductCategories.mockResolvedValue([]);
});

afterAll(async () => {
  await apollo.stop();
});

const QUERY = `
  query ($userId: String!, $limit: Int) {
    recommendations(userId: $userId, limit: $limit) {
      productId score reason explanation averageRating reviewCount category
    }
  }
`;

describe('Query recommendations(userId)', () => {
  it('renvoie une liste vide quand la base est vide', async () => {
    const result = await run(QUERY, { userId: USER_ID });

    expect(result.errors).toBeUndefined();
    expect(result.data?.['recommendations']).toEqual([]);
  });

  it('recommande les produits bien notés à un client sans historique', async () => {
    reviewRepo.aggregateRatings.mockResolvedValue([
      { productId: 'p-a', average: 4.9, count: 30, distribution: {} },
      { productId: 'p-b', average: 2.1, count: 30, distribution: {} },
    ]);

    const result = await run(QUERY, { userId: 'nouveau-client' });
    const recos = result.data?.['recommendations'] as { productId: string; reason: string }[];

    expect(recos[0]?.productId).toBe('p-a');
    expect(recos[0]?.reason).toBe('HIGHLY_RATED');
  });

  it('chaque recommandation porte une explication en clair', async () => {
    reviewRepo.aggregateRatings.mockResolvedValue([
      { productId: 'p-a', average: 4.5, count: 12, distribution: {} },
    ]);

    const result = await run(QUERY, { userId: USER_ID });
    const recos = result.data?.['recommendations'] as { explanation: string }[];

    expect(recos[0]?.explanation).toContain('4.5/5');
    expect(recos[0]?.explanation).toContain('12 client(s)');
  });

  it('privilégie la catégorie consultée par le client', async () => {
    reviewRepo.aggregateRatings.mockResolvedValue([
      { productId: 'p-audio', average: 3.0, count: 10, distribution: {} },
      { productId: 'p-autre', average: 4.2, count: 10, distribution: {} },
    ]);
    browsingRepo.aggregateCategoryCounts.mockResolvedValue([
      { category: 'audio', count: 40 },
    ]);
    browsingRepo.findProductCategories.mockResolvedValue([
      { productId: 'p-audio', category: 'audio' },
      { productId: 'p-autre', category: 'cuisine' },
    ]);

    const result = await run(QUERY, { userId: USER_ID });
    const recos = result.data?.['recommendations'] as {
      productId: string;
      reason: string;
      category: string;
    }[];

    expect(recos[0]?.productId).toBe('p-audio');
    expect(recos[0]?.reason).toBe('CATEGORY_AFFINITY');
    expect(recos[0]?.category).toBe('audio');
  });

  it('n’recommande pas un produit déjà noté par le client', async () => {
    reviewRepo.aggregateRatings.mockResolvedValue([
      { productId: 'p-deja-note', average: 5, count: 50, distribution: {} },
      { productId: 'p-neuf', average: 3, count: 50, distribution: {} },
    ]);
    reviewRepo.findReviewedProductIds.mockResolvedValue(['p-deja-note']);

    const result = await run(QUERY, { userId: USER_ID });
    const recos = result.data?.['recommendations'] as { productId: string }[];

    expect(recos.map((r) => r.productId)).toEqual(['p-neuf']);
  });

  it('n’recommande pas un produit déjà acheté', async () => {
    reviewRepo.aggregateRatings.mockResolvedValue([
      { productId: 'p-achete', average: 5, count: 50, distribution: {} },
    ]);
    browsingRepo.findPurchasedProductIds.mockResolvedValue(['p-achete']);

    const result = await run(QUERY, { userId: USER_ID });

    expect(result.data?.['recommendations']).toEqual([]);
  });

  it('respecte la limite demandée', async () => {
    reviewRepo.aggregateRatings.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({
        productId: `p-${String(i)}`,
        average: 4,
        count: 5,
        distribution: {},
      })),
    );

    const result = await run(QUERY, { userId: USER_ID, limit: 3 });

    expect(result.data?.['recommendations']).toHaveLength(3);
  });

  it('rejette une limite excessive', async () => {
    const result = await run(QUERY, { userId: USER_ID, limit: 999 });

    expect(result.errors?.[0]?.extensions?.['code']).toBe('BAD_USER_INPUT');
  });

  it('est déterministe : deux appels identiques donnent le même ordre', async () => {
    reviewRepo.aggregateRatings.mockResolvedValue([
      { productId: 'p-b', average: 4, count: 10, distribution: {} },
      { productId: 'p-a', average: 4, count: 10, distribution: {} },
      { productId: 'p-c', average: 4, count: 10, distribution: {} },
    ]);

    const premier = await run(QUERY, { userId: USER_ID });
    const second = await run(QUERY, { userId: USER_ID });

    expect(premier.data?.['recommendations']).toEqual(second.data?.['recommendations']);
  });
});

describe('Historique de navigation', () => {
  it('trackBrowsingEvent enregistre une consultation', async () => {
    browsingRepo.create.mockResolvedValue(makeBrowsingEventDocument());

    const result = await run(
      `mutation ($input: TrackBrowsingEventInput!) {
         trackBrowsingEvent(input: $input) { id userId category eventType }
       }`,
      {
        input: {
          userId: USER_ID,
          productId: 'SS-PRD-00001',
          category: 'audio',
          eventType: 'VIEW',
        },
      },
    );

    expect(result.errors).toBeUndefined();
    expect(result.data?.['trackBrowsingEvent']).toMatchObject({
      category: 'audio',
      eventType: 'VIEW',
    });
  });

  it('rejette une catégorie vide', async () => {
    const result = await run(
      `mutation ($input: TrackBrowsingEventInput!) {
         trackBrowsingEvent(input: $input) { id }
       }`,
      {
        input: { userId: USER_ID, productId: 'p-1', category: '  ' },
      },
    );

    expect(result.errors?.[0]?.extensions?.['code']).toBe('BAD_USER_INPUT');
    expect(browsingRepo.create).not.toHaveBeenCalled();
  });

  it('browsingHistory renvoie l’historique du client', async () => {
    browsingRepo.findByUser.mockResolvedValue([makeBrowsingEventDocument()]);

    const result = await run(
      `{ browsingHistory(userId: "${USER_ID}", limit: 10) { productId category } }`,
    );

    expect(result.errors).toBeUndefined();
    expect(browsingRepo.findByUser).toHaveBeenCalledWith(USER_ID, 10);
  });

  it('plafonne la limite de l’historique à 200', async () => {
    browsingRepo.findByUser.mockResolvedValue([]);

    await run(`{ browsingHistory(userId: "${USER_ID}", limit: 9999) { productId } }`);

    expect(browsingRepo.findByUser).toHaveBeenCalledWith(USER_ID, 200);
  });
});
