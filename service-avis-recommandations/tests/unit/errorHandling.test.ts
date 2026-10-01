import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { makeBrowsingEventDocument, REVIEW_ID, USER_ID, makeTestContext } from '../helpers/fixtures.js';

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
const browsingRepo = {
  create: vi.fn(),
  findByUser: vi.fn(),
  aggregateCategoryCounts: vi.fn(),
  findViewedProductIds: vi.fn(),
  findPurchasedProductIds: vi.fn(),
  aggregateCoViewedProducts: vi.fn(),
  findProductCategories: vi.fn(),
};
vi.mock('../../src/repositories/review.repository.js', () => reviewRepo);
vi.mock('../../src/repositories/browsingEvent.repository.js', () => browsingRepo);
vi.mock('../../src/db/mongoose.js', () => ({
  connectWithRetry: vi.fn(),
  disconnectMongoose: vi.fn(),
  isDatabaseReachable: vi.fn().mockReturnValue(true),
}));

const { createApolloServer } = await import('../../src/app.js');
const { translateMongoError } = await import('../../src/utils/mongoError.js');
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
});

afterAll(async () => {
  await apollo.stop();
});

describe('translateMongoError', () => {
  it('convertit une violation d’index unique en CONFLICT 409', async () => {
    const { ConflictError } = await import('../../src/errors/AppError.js');

    const translated = translateMongoError(
      Object.assign(new Error('E11000 duplicate key error'), {
        name: 'MongoServerError',
        code: 11000,
        keyValue: { userId: 'u1', productId: 'p1' },
      }),
    );

    expect(translated).toBeInstanceOf(ConflictError);
    expect((translated as InstanceType<typeof ConflictError>).detail).toContain('userId');
  });

  it('convertit une base injoignable en 503, pas en 500', async () => {
    const { ServiceUnavailableError } = await import('../../src/errors/AppError.js');

    const translated = translateMongoError(
      new mongoose.Error.MongooseServerSelectionError({
        message: 'connexion impossible',
      } as never),
    );

    expect(translated).toBeInstanceOf(ServiceUnavailableError);
    expect((translated as InstanceType<typeof ServiceUnavailableError>).status).toBe(503);
  });

  it('convertit une erreur de validation Mongoose en 400', async () => {
    const { ValidationError } = await import('../../src/errors/AppError.js');

    const mongooseError = new mongoose.Error.ValidationError();
    mongooseError.errors['rating'] = new mongoose.Error.ValidatorError({
      path: 'rating',
      message: 'la note doit être comprise entre 1 et 5',
    });

    const translated = translateMongoError(mongooseError);

    expect(translated).toBeInstanceOf(ValidationError);
    expect((translated as InstanceType<typeof ValidationError>).message).toContain('rating');
  });

  it('convertit une CastError en 400', async () => {
    const { ValidationError } = await import('../../src/errors/AppError.js');

    const translated = translateMongoError(
      new mongoose.Error.CastError('Number', 'abc', 'rating'),
    );

    expect(translated).toBeInstanceOf(ValidationError);
  });

  it('laisse passer une erreur qui ne vient pas de MongoDB', () => {
    const original = new Error('erreur quelconque');

    expect(translateMongoError(original)).toBe(original);
  });

  it('ignore les valeurs non objet', () => {
    expect(translateMongoError(null)).toBeNull();
    expect(translateMongoError('texte')).toBe('texte');
  });
});

describe('Erreurs MongoDB remontées par l’API GraphQL', () => {
  it('une course sur l’index unique donne CONFLICT, pas une erreur interne', async () => {
    // Deux requêtes concurrentes : la pré-vérification passe, puis l'index
    // unique rejette l'écriture. Sans traduction, ce serait un 500.
    reviewRepo.findByUserAndProduct.mockResolvedValue(null);
    reviewRepo.create.mockRejectedValue(
      // Forme réelle d'un MongoServerError : une Error portant `code`.
      Object.assign(new Error('E11000 duplicate key error collection: reviews'), {
        name: 'MongoServerError',
        code: 11000,
        keyValue: { userId: USER_ID, productId: 'p1' },
      }),
    );

    const result = await run(
      `mutation ($input: CreateReviewInput!) { createReview(input: $input) { id } }`,
      {
        input: {
          userId: USER_ID,
          productId: 'p1',
          rating: 4,
          comment: 'Très bien.',
        },
      },
    );

    expect(result.errors?.[0]?.extensions?.['code']).toBe('CONFLICT');
    expect(result.errors?.[0]?.extensions?.['status']).toBe(409);
  });

  it('une base injoignable donne SERVICE_UNAVAILABLE', async () => {
    reviewRepo.findById.mockRejectedValue(
      new mongoose.Error.MongooseServerSelectionError({
        message: 'connexion impossible',
      } as never),
    );

    const result = await run(`{ review(id: "${REVIEW_ID}") { id } }`);

    expect(result.errors?.[0]?.extensions?.['code']).toBe('SERVICE_UNAVAILABLE');
    expect(result.errors?.[0]?.extensions?.['status']).toBe(503);
  });
});

describe('Champ metadata — souplesse NoSQL exposée par l’API', () => {
  it('accepte et restitue des données libres sans schéma imposé', async () => {
    browsingRepo.create.mockResolvedValue(
      makeBrowsingEventDocument({
        eventType: 'SEARCH',
        metadata: { terme: 'casque bluetooth', resultats: 12, filtres: ['audio'] },
      }),
    );

    const result = await run(
      `mutation ($input: TrackBrowsingEventInput!) {
         trackBrowsingEvent(input: $input) { id eventType metadata }
       }`,
      {
        input: {
          userId: USER_ID,
          productId: 'p1',
          category: 'audio',
          eventType: 'SEARCH',
          metadata: { terme: 'casque bluetooth', resultats: 12, filtres: ['audio'] },
        },
      },
    );

    expect(result.errors).toBeUndefined();
    expect(result.data?.['trackBrowsingEvent']).toMatchObject({
      eventType: 'SEARCH',
      metadata: { terme: 'casque bluetooth', resultats: 12, filtres: ['audio'] },
    });
    expect(browsingRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { terme: 'casque bluetooth', resultats: 12, filtres: ['audio'] },
      }),
    );
  });

  it('renvoie null quand aucune donnée libre n’est attachée', async () => {
    browsingRepo.create.mockResolvedValue(makeBrowsingEventDocument());

    const result = await run(
      `mutation ($input: TrackBrowsingEventInput!) {
         trackBrowsingEvent(input: $input) { metadata }
       }`,
      { input: { userId: USER_ID, productId: 'p1', category: 'audio' } },
    );

    expect(result.data?.['trackBrowsingEvent']).toEqual({ metadata: null });
  });

  it('accepte un littéral JSON inline dans la requête', async () => {
    browsingRepo.create.mockResolvedValue(
      makeBrowsingEventDocument({ metadata: { source: 'newsletter', rang: 3 } }),
    );

    const result = await run(
      `mutation {
         trackBrowsingEvent(input: {
           userId: "${USER_ID}", productId: "p1", category: "audio",
           metadata: { source: "newsletter", rang: 3 }
         }) { metadata }
       }`,
    );

    expect(result.errors).toBeUndefined();
    expect(browsingRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { source: 'newsletter', rang: 3 } }),
    );
  });
});

describe('userReviews — filtre par tags', () => {
  it('transmet les tags au repository', async () => {
    reviewRepo.findPage.mockResolvedValue({ items: [], total: 0 });

    await run(`{ userReviews(userId: "${USER_ID}", tags: ["qualité"]) { total } }`);

    expect(reviewRepo.findPage).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, tags: ['qualité'] }),
      'NEWEST',
      20,
      0,
    );
  });
});
