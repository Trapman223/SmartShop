import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import {
  makeReviewDocument,
  PRODUCT_ID,
  REVIEW_ID,
  UNKNOWN_ID,
  USER_ID,
  makeTestContext,
} from '../helpers/fixtures.js';

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
const apollo = createApolloServer();

const CONTEXT = makeTestContext();

async function run(query: string, variables?: Record<string, unknown>) {
  const response = await apollo.executeOperation(
    { query, ...(variables !== undefined ? { variables } : {}) },
    { contextValue: CONTEXT },
  );
  if (response.body.kind !== 'single') throw new Error('réponse inattendue');
  return response.body.singleResult;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(async () => {
  await apollo.stop();
});

describe('Query review(id)', () => {
  it('renvoie l’avis demandé', async () => {
    reviewRepo.findById.mockResolvedValue(makeReviewDocument());

    const result = await run(`{ review(id: "${REVIEW_ID}") { id rating tags } }`);

    expect(result.errors).toBeUndefined();
    expect(result.data?.['review']).toMatchObject({
      id: REVIEW_ID,
      rating: 5,
      tags: ['qualité', 'livraison'],
    });
  });

  it('remonte NOT_FOUND sur un identifiant inconnu', async () => {
    reviewRepo.findById.mockResolvedValue(null);

    const result = await run(`{ review(id: "${UNKNOWN_ID}") { id } }`);

    expect(result.errors?.[0]?.extensions?.['code']).toBe('NOT_FOUND');
    expect(result.errors?.[0]?.extensions?.['status']).toBe(404);
  });

  it('rejette un identifiant qui n’est pas un ObjectId', async () => {
    const result = await run('{ review(id: "abc") { id } }');

    expect(result.errors?.[0]?.extensions?.['code']).toBe('BAD_USER_INPUT');
    expect(reviewRepo.findById).not.toHaveBeenCalled();
  });
});

describe('Query productsReviews(productId)', () => {
  it('renvoie une page d’avis avec ses métadonnées', async () => {
    reviewRepo.findPage.mockResolvedValue({
      items: [makeReviewDocument()],
      total: 1,
    });

    const result = await run(
      `{ productsReviews(productId: "${PRODUCT_ID}") { total limit offset hasMore items { id } } }`,
    );

    expect(result.errors).toBeUndefined();
    expect(result.data?.['productsReviews']).toMatchObject({
      total: 1,
      limit: 20,
      offset: 0,
      hasMore: false,
    });
  });

  it('indique hasMore quand la page ne couvre pas le total', async () => {
    reviewRepo.findPage.mockResolvedValue({
      items: [makeReviewDocument()],
      total: 50,
    });

    const result = await run(
      `{ productsReviews(productId: "${PRODUCT_ID}", limit: 1) { hasMore total } }`,
    );

    expect(result.data?.['productsReviews']).toMatchObject({ hasMore: true, total: 50 });
  });

  it('transmet le tri et le filtre de note au repository', async () => {
    reviewRepo.findPage.mockResolvedValue({ items: [], total: 0 });

    await run(
      `{ productsReviews(productId: "${PRODUCT_ID}", sort: HIGHEST_RATING, minRating: 4) { total } }`,
    );

    expect(reviewRepo.findPage).toHaveBeenCalledWith(
      expect.objectContaining({ productId: PRODUCT_ID, minRating: 4 }),
      'HIGHEST_RATING',
      20,
      0,
    );
  });

  it('refuse une limite au-delà du plafond', async () => {
    const result = await run(
      `{ productsReviews(productId: "${PRODUCT_ID}", limit: 5000) { total } }`,
    );

    expect(result.errors?.[0]?.extensions?.['code']).toBe('BAD_USER_INPUT');
  });
});

describe('Query userReviews(userId) — historique des avis', () => {
  it('filtre sur le client demandé', async () => {
    reviewRepo.findPage.mockResolvedValue({
      items: [makeReviewDocument()],
      total: 1,
    });

    const result = await run(
      `{ userReviews(userId: "${USER_ID}") { items { userId productId } } }`,
    );

    expect(result.errors).toBeUndefined();
    expect(reviewRepo.findPage).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
      'NEWEST',
      20,
      0,
    );
  });
});

describe('Mutation createReview', () => {
  const input = {
    userId: USER_ID,
    productId: PRODUCT_ID,
    rating: 4,
    comment: 'Bon rapport qualité-prix.',
    tags: ['qualité'],
  };

  const MUTATION = `
    mutation ($input: CreateReviewInput!) {
      createReview(input: $input) { id rating comment tags }
    }
  `;

  it('crée l’avis et le renvoie', async () => {
    reviewRepo.findByUserAndProduct.mockResolvedValue(null);
    reviewRepo.create.mockResolvedValue(makeReviewDocument({ rating: 4 }));

    const result = await run(MUTATION, { input });

    expect(result.errors).toBeUndefined();
    expect(result.data?.['createReview']).toMatchObject({ rating: 4 });
  });

  it('rejette une note à 0 en nommant le champ et la règle', async () => {
    const result = await run(MUTATION, { input: { ...input, rating: 0 } });

    expect(result.errors?.[0]?.extensions?.['code']).toBe('BAD_USER_INPUT');
    // Le message doit être exploitable tel quel par le client.
    expect(result.errors?.[0]?.message).toContain('rating');
    expect(result.errors?.[0]?.message).toContain('entre 1 et 5');
    expect(result.errors?.[0]?.extensions?.['detail']).toContain('rating');
    expect(reviewRepo.create).not.toHaveBeenCalled();
  });

  it('rejette une note à 6', async () => {
    const result = await run(MUTATION, { input: { ...input, rating: 6 } });

    expect(result.errors?.[0]?.extensions?.['code']).toBe('BAD_USER_INPUT');
  });

  it('rejette une note décimale', async () => {
    const result = await run(MUTATION, { input: { ...input, rating: 4.5 } });

    expect(result.errors).toBeDefined();
    expect(reviewRepo.create).not.toHaveBeenCalled();
  });

  it('accepte les notes aux bornes 1 et 5', async () => {
    reviewRepo.findByUserAndProduct.mockResolvedValue(null);
    reviewRepo.create.mockResolvedValue(makeReviewDocument());

    for (const rating of [1, 5]) {
      const result = await run(MUTATION, { input: { ...input, rating } });
      expect(result.errors).toBeUndefined();
    }
  });

  it('rejette un commentaire vide', async () => {
    const result = await run(MUTATION, { input: { ...input, comment: '   ' } });

    expect(result.errors?.[0]?.extensions?.['code']).toBe('BAD_USER_INPUT');
  });

  it('normalise les tags en minuscules et les dédoublonne', async () => {
    reviewRepo.findByUserAndProduct.mockResolvedValue(null);
    reviewRepo.create.mockResolvedValue(makeReviewDocument());

    await run(MUTATION, {
      input: { ...input, tags: ['Qualité', 'qualité', 'LIVRAISON'] },
    });

    expect(reviewRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ['qualité', 'livraison'] }),
    );
  });

  it('refuse un deuxième avis du même client sur le même produit', async () => {
    reviewRepo.findByUserAndProduct.mockResolvedValue(makeReviewDocument());

    const result = await run(MUTATION, { input });

    expect(result.errors?.[0]?.extensions?.['code']).toBe('CONFLICT');
    expect(result.errors?.[0]?.extensions?.['status']).toBe(409);
    expect(reviewRepo.create).not.toHaveBeenCalled();
  });
});

describe('Mutation updateReview', () => {
  const MUTATION = `
    mutation ($id: ID!, $input: UpdateReviewInput!) {
      updateReview(id: $id, input: $input) { id rating comment }
    }
  `;

  it('met à jour la note', async () => {
    reviewRepo.updateById.mockResolvedValue(makeReviewDocument({ rating: 2 }));

    const result = await run(MUTATION, { id: REVIEW_ID, input: { rating: 2 } });

    expect(result.errors).toBeUndefined();
    expect(result.data?.['updateReview']).toMatchObject({ rating: 2 });
  });

  it('refuse une mise à jour vide', async () => {
    const result = await run(MUTATION, { id: REVIEW_ID, input: {} });

    expect(result.errors?.[0]?.extensions?.['code']).toBe('BAD_USER_INPUT');
    expect(reviewRepo.updateById).not.toHaveBeenCalled();
  });

  it('refuse une note hors bornes', async () => {
    const result = await run(MUTATION, { id: REVIEW_ID, input: { rating: 12 } });

    expect(result.errors?.[0]?.extensions?.['code']).toBe('BAD_USER_INPUT');
  });

  it('remonte NOT_FOUND si l’avis n’existe pas', async () => {
    reviewRepo.updateById.mockResolvedValue(null);

    const result = await run(MUTATION, { id: UNKNOWN_ID, input: { rating: 3 } });

    expect(result.errors?.[0]?.extensions?.['code']).toBe('NOT_FOUND');
  });
});

describe('Mutation deleteReview', () => {
  it('supprime et confirme', async () => {
    reviewRepo.deleteById.mockResolvedValue(true);

    const result = await run(
      `mutation { deleteReview(id: "${REVIEW_ID}") { id deleted } }`,
    );

    expect(result.data?.['deleteReview']).toEqual({ id: REVIEW_ID, deleted: true });
  });

  it('remonte NOT_FOUND si rien n’a été supprimé', async () => {
    reviewRepo.deleteById.mockResolvedValue(false);

    const result = await run(
      `mutation { deleteReview(id: "${UNKNOWN_ID}") { id deleted } }`,
    );

    expect(result.errors?.[0]?.extensions?.['code']).toBe('NOT_FOUND');
  });
});

describe('Query productRating', () => {
  it('agrège note moyenne, décompte et distribution', async () => {
    reviewRepo.aggregateRatings.mockResolvedValue([
      {
        productId: PRODUCT_ID,
        average: 4.333333,
        count: 3,
        distribution: { '1': 0, '2': 0, '3': 1, '4': 0, '5': 2 },
      },
    ]);
    reviewRepo.aggregateTopTags.mockResolvedValue([{ tag: 'qualité', count: 2 }]);

    const result = await run(
      `{ productRating(productId: "${PRODUCT_ID}") {
          average count distribution { one three five } topTags { tag count }
      } }`,
    );

    expect(result.errors).toBeUndefined();
    expect(result.data?.['productRating']).toMatchObject({
      average: 4.33,
      count: 3,
      distribution: { one: 0, three: 1, five: 2 },
      topTags: [{ tag: 'qualité', count: 2 }],
    });
  });

  it('renvoie un agrégat vide pour un produit sans avis', async () => {
    reviewRepo.aggregateRatings.mockResolvedValue([]);
    reviewRepo.aggregateTopTags.mockResolvedValue([]);

    const result = await run(
      `{ productRating(productId: "inconnu") { average count } }`,
    );

    expect(result.data?.['productRating']).toEqual({ average: 0, count: 0 });
  });
});
