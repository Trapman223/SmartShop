import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { makeTestContext } from '../helpers/fixtures.js';

// Ces tests tournent explicitement en NODE_ENV=production : c'est le seul
// mode où le masquage des erreurs s'applique. Les suites existantes tournent
// en 'test' et ne pouvaient donc pas détecter la régression.
vi.stubEnv('NODE_ENV', 'production');

vi.mock('../../src/repositories/review.repository.js', () => ({
  findPage: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  findById: vi.fn().mockResolvedValue(null),
  findByUserAndProduct: vi.fn().mockResolvedValue(null),
  create: vi.fn(),
  updateById: vi.fn(),
  deleteById: vi.fn(),
  findReviewedProductIds: vi.fn().mockResolvedValue([]),
  aggregateRatings: vi.fn().mockResolvedValue([]),
  aggregateTopTags: vi.fn().mockResolvedValue([]),
}));
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

const code = (r: Awaited<ReturnType<typeof run>>): unknown =>
  r.errors?.[0]?.extensions?.['code'];

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(async () => {
  await apollo.stop();
  vi.unstubAllEnvs();
});

describe('En production, les erreurs du CLIENT ne sont pas masquées', () => {
  it('un champ inconnu renvoie GRAPHQL_VALIDATION_FAILED, pas une erreur interne', async () => {
    const result = await run('{ review(id: "507f1f77bcf86cd799439011") { champInconnu } }');

    expect(code(result)).toBe('GRAPHQL_VALIDATION_FAILED');
    expect(result.errors?.[0]?.message).not.toBe('Erreur interne du serveur');
    expect(result.errors?.[0]?.message).toContain('champInconnu');
  });

  it('une query inexistante renvoie GRAPHQL_VALIDATION_FAILED', async () => {
    const result = await run('{ nExistePas { id } }');

    expect(code(result)).toBe('GRAPHQL_VALIDATION_FAILED');
  });

  it('une valeur d’enum inconnue renvoie GRAPHQL_VALIDATION_FAILED', async () => {
    const result = await run('{ productsReviews(productId: "p1", sort: MEILLEUR) { total } }');

    expect(code(result)).toBe('GRAPHQL_VALIDATION_FAILED');
  });

  it('un Int non entier renvoie BAD_USER_INPUT', async () => {
    const result = await run(
      'mutation($i:CreateReviewInput!){createReview(input:$i){id}}',
      { i: { userId: 'u', productId: 'p', rating: 4.5, comment: 'Decimal.' } },
    );

    expect(code(result)).toBe('BAD_USER_INPUT');
  });

  it('un champ obligatoire manquant renvoie BAD_USER_INPUT', async () => {
    const result = await run(
      'mutation($i:CreateReviewInput!){createReview(input:$i){id}}',
      { i: { userId: 'u', productId: 'p', comment: 'Sans note.' } },
    );

    expect(code(result)).toBe('BAD_USER_INPUT');
  });

  it('une requête syntaxiquement invalide renvoie GRAPHQL_PARSE_FAILED', async () => {
    const result = await run('{ review(id: "x" { id }');

    expect(code(result)).toBe('GRAPHQL_PARSE_FAILED');
  });

  it('les erreurs métier typées restent correctement classées', async () => {
    const result = await run('{ review(id: "507f1f77bcf86cd799439011") { id } }');

    expect(code(result)).toBe('NOT_FOUND');
  });

  it('une règle métier violée reste en BAD_USER_INPUT', async () => {
    const result = await run(
      'mutation($i:CreateReviewInput!){createReview(input:$i){id}}',
      { i: { userId: 'u', productId: 'p', rating: 9, comment: 'Hors bornes.' } },
    );

    expect(code(result)).toBe('BAD_USER_INPUT');
    expect(result.errors?.[0]?.message).toContain('entre 1 et 5');
  });
});

describe('En production, les erreurs SERVEUR restent masquées', () => {
  it('une erreur inattendue ne fuite ni message ni pile', async () => {
    const repo = await import('../../src/repositories/review.repository.js');
    vi.mocked(repo.findById).mockRejectedValueOnce(
      new Error('détail interne confidentiel : mot de passe=abc'),
    );

    const result = await run('{ review(id: "507f1f77bcf86cd799439011") { id } }');

    expect(code(result)).toBe('INTERNAL_SERVER_ERROR');
    expect(result.errors?.[0]?.message).toBe('Erreur interne du serveur');
    expect(JSON.stringify(result.errors)).not.toContain('confidentiel');
    expect(JSON.stringify(result.errors)).not.toContain('stacktrace');
  });
});
