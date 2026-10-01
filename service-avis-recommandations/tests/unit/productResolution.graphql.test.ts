import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import {
  makeCatalogueProduct,
  makeReviewDocument,
  makeTestContext,
  PRODUCT_ID,
  REVIEW_ID,
} from '../helpers/fixtures.js';

/**
 * Flux 1 vu depuis GraphQL : les champs `product` de `Review`,
 * `ProductRating` et `Recommendation` sont-ils bien résolus auprès de
 * `catalogue-api`, et la requête survit-elle à son indisponibilité ?
 */

const reviewRepo = {
  findPage: vi.fn(),
  findById: vi.fn(),
  findByUserAndProduct: vi.fn(),
  create: vi.fn(),
  updateById: vi.fn(),
  deleteById: vi.fn(),
  findReviewedProductIds: vi.fn(),
  aggregateRatings: vi.fn(),
  aggregateTopTags: vi.fn(),
};
vi.mock('../../src/repositories/review.repository.js', () => reviewRepo);
vi.mock('../../src/db/mongoose.js', () => ({
  connectWithRetry: vi.fn(),
  disconnectMongoose: vi.fn(),
  isDatabaseReachable: vi.fn().mockReturnValue(true),
}));

const { createApolloServer } = await import('../../src/app.js');
const { createProductLoader } = await import('../../src/clients/product.loader.js');
const apollo = createApolloServer();

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await apollo.stop();
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/** Contexte branché sur le vrai loader : le flux 1 passe par `fetch`. */
function liveContext() {
  return {
    traceId: 'trace-flux-1',
    customerId: undefined,
    loaders: { product: createProductLoader('trace-flux-1') },
  };
}

async function run(
  query: string,
  contextValue: ReturnType<typeof liveContext> | ReturnType<typeof makeTestContext>,
) {
  const response = await apollo.executeOperation({ query }, { contextValue });
  if (response.body.kind !== 'single') throw new Error('réponse inattendue');
  return response.body.singleResult;
}

describe('Review.product — résolution auprès de catalogue-api', () => {
  it('enrichit un avis avec son produit', async () => {
    reviewRepo.findById.mockResolvedValue(makeReviewDocument());
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: [makeCatalogueProduct({ reference: PRODUCT_ID, name: 'Casque audio' })],
      }),
    );

    const result = await run(
      `{ review(id: "${REVIEW_ID}") { id productId product { reference name price stock available } } }`,
      liveContext(),
    );

    expect(result.errors).toBeUndefined();
    expect(result.data?.['review']).toMatchObject({
      productId: PRODUCT_ID,
      product: {
        reference: PRODUCT_ID,
        name: 'Casque audio',
        price: '149.90',
        available: true,
      },
    });
  });

  it('sert l’avis avec product: null quand catalogue-api est injoignable', async () => {
    reviewRepo.findById.mockResolvedValue(makeReviewDocument());
    fetchMock.mockRejectedValue(new Error('fetch failed'));

    const result = await run(
      `{ review(id: "${REVIEW_ID}") { id rating product { name } } }`,
      liveContext(),
    );

    // Mode dégradé : aucune erreur GraphQL, les données MongoDB sont servies.
    expect(result.errors).toBeUndefined();
    expect(result.data?.['review']).toMatchObject({ rating: 5, product: null });
  });

  it('renvoie product: null pour une référence absente du catalogue', async () => {
    reviewRepo.findById.mockResolvedValue(makeReviewDocument());
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));

    const result = await run(
      `{ review(id: "${REVIEW_ID}") { product { name } } }`,
      liveContext(),
    );

    expect(result.errors).toBeUndefined();
    expect(result.data?.['review']).toMatchObject({ product: null });
  });
});

describe('Batching sur une page d’avis', () => {
  it('résout 3 avis portant sur 2 produits en un seul appel au catalogue', async () => {
    reviewRepo.findPage.mockResolvedValue({
      items: [
        makeReviewDocument({ id: '1', productId: 'SS-PRD-00001' }),
        makeReviewDocument({ id: '2', productId: 'SS-PRD-00002' }),
        makeReviewDocument({ id: '3', productId: 'SS-PRD-00001' }),
      ],
      total: 3,
    });
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: [
          makeCatalogueProduct({ reference: 'SS-PRD-00001', name: 'Casque' }),
          makeCatalogueProduct({ reference: 'SS-PRD-00002', name: 'Clavier' }),
        ],
      }),
    );

    const result = await run(
      `{ productsReviews(productId: "SS-PRD-00001") { items { id product { name } } } }`,
      liveContext(),
    );

    expect(result.errors).toBeUndefined();
    // Preuve de l'absence de N+1 : 3 champs `product`, 1 seul appel HTTP.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const refs = new URL((fetchMock.mock.calls[0] as [string])[0]).searchParams.get('refs');
    expect(refs).toBe('SS-PRD-00001,SS-PRD-00002');
  });
});

describe('ProductRating.product — résolution auprès de catalogue-api', () => {
  it('enrichit une note agrégée avec son produit', async () => {
    reviewRepo.aggregateRatings.mockResolvedValue([
      { productId: PRODUCT_ID, average: 4.5, count: 2, distribution: [4, 5] },
    ]);
    reviewRepo.aggregateTopTags.mockResolvedValue([]);

    const context = makeTestContext(
      new Map([[PRODUCT_ID, makeCatalogueProduct({ reference: PRODUCT_ID, name: 'Casque' })]]),
    );

    const result = await run(
      `{ productRating(productId: "${PRODUCT_ID}") { productId average product { name } } }`,
      context,
    );

    expect(result.errors).toBeUndefined();
    expect(result.data?.['productRating']).toMatchObject({
      productId: PRODUCT_ID,
      product: { name: 'Casque' },
    });
  });
});
