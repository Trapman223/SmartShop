import { describe, it, expect, vi, afterAll } from 'vitest';
import { Kind } from 'graphql';
import { DateTimeScalar } from '../../src/graphql/scalars.js';

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

describe('Scalaire DateTime', () => {
  const date = new Date('2026-03-01T10:00:00.000Z');

  it('sérialise une Date en ISO 8601', () => {
    expect(DateTimeScalar.serialize(date)).toBe('2026-03-01T10:00:00.000Z');
  });

  it('sérialise une chaîne de date en ISO 8601', () => {
    expect(DateTimeScalar.serialize('2026-03-01')).toBe('2026-03-01T00:00:00.000Z');
  });

  it('refuse de sérialiser une valeur non temporelle', () => {
    expect(() => DateTimeScalar.serialize(42)).toThrow(TypeError);
  });

  it('parse une variable chaîne en Date', () => {
    expect(DateTimeScalar.parseValue('2026-03-01T10:00:00.000Z')).toEqual(date);
  });

  it('refuse une variable non chaîne', () => {
    expect(() => DateTimeScalar.parseValue(42)).toThrow(TypeError);
  });

  it('refuse une date invalide en variable', () => {
    expect(() => DateTimeScalar.parseValue('pas-une-date')).toThrow(TypeError);
  });

  it('parse un littéral chaîne', () => {
    expect(
      DateTimeScalar.parseLiteral(
        { kind: Kind.STRING, value: '2026-03-01T10:00:00.000Z' },
        null,
      ),
    ).toEqual(date);
  });

  it('refuse un littéral d’un autre type', () => {
    expect(() =>
      DateTimeScalar.parseLiteral({ kind: Kind.INT, value: '42' }, null),
    ).toThrow(TypeError);
  });

  it('refuse un littéral de date invalide', () => {
    expect(() =>
      DateTimeScalar.parseLiteral({ kind: Kind.STRING, value: 'xyz' }, null),
    ).toThrow(TypeError);
  });
});

describe('Query productRatings — agrégation par lot', () => {
  it('renvoie une entrée par produit demandé, même sans avis', async () => {
    reviewRepo.aggregateRatings.mockResolvedValue([
      { productId: 'p-a', average: 4, count: 2, distribution: { '1': 0, '2': 0, '3': 0, '4': 2, '5': 0 } },
    ]);

    const { createApolloServer } = await import('../../src/app.js');
    const apollo = createApolloServer();

    const response = await apollo.executeOperation(
      {
        query: '{ productRatings(productIds: ["p-a", "p-inconnu"]) { productId average count } }',
      },
      { contextValue: { traceId: 'test', customerId: undefined } },
    );

    if (response.body.kind !== 'single') throw new Error('réponse inattendue');
    expect(response.body.singleResult.errors).toBeUndefined();
    expect(response.body.singleResult.data?.['productRatings']).toEqual([
      { productId: 'p-a', average: 4, count: 2 },
      { productId: 'p-inconnu', average: 0, count: 0 },
    ]);

    await apollo.stop();
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});
