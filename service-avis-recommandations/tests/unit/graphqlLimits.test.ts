import { describe, it, expect, vi, afterAll } from 'vitest';
import { makeTestContext } from '../helpers/fixtures.js';

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

async function run(query: string) {
  const response = await apollo.executeOperation(
    { query },
    { contextValue: makeTestContext() },
  );
  if (response.body.kind !== 'single') throw new Error('réponse inattendue');
  return response.body.singleResult;
}

afterAll(async () => {
  await apollo.stop();
});

describe('Limite du nombre de champs racine', () => {
  it('accepte une requête à plusieurs champs sous le plafond', async () => {
    const champs = Array.from(
      { length: 5 },
      (_, i) => `a${String(i)}: productsReviews(productId: "p1") { total }`,
    ).join(' ');

    const result = await run(`{ ${champs} }`);

    expect(result.errors).toBeUndefined();
  });

  it('refuse l’amplification par alias — 200 champs racine', async () => {
    // Sans cette règle, 200 alias déclenchaient 200 agrégations MongoDB en
    // un seul appel HTTP (mesuré à 3,9 s sur la stack déployée).
    const champs = Array.from(
      { length: 200 },
      (_, i) => `a${String(i)}: productsReviews(productId: "p1") { total }`,
    ).join(' ');

    const result = await run(`{ ${champs} }`);

    expect(result.errors).toBeDefined();
    expect(result.errors?.[0]?.message).toContain('Trop de champs racine');
    expect(result.errors?.[0]?.extensions?.['code']).toBe('GRAPHQL_VALIDATION_FAILED');
  });

  it('refuse l’amplification exprimée via un fragment', async () => {
    const champs = Array.from(
      { length: 50 },
      (_, i) => `b${String(i)}: productsReviews(productId: "p1") { total }`,
    ).join(' ');

    const result = await run(
      `{ ...Beaucoup } fragment Beaucoup on Query { ${champs} }`,
    );

    expect(result.errors?.[0]?.message).toContain('Trop de champs racine');
  });

  it('compte les champs d’une mutation aussi', async () => {
    const champs = Array.from(
      { length: 30 },
      (_, i) =>
        `m${String(i)}: trackBrowsingEvent(input: {userId: "u", productId: "p", category: "c"}) { id }`,
    ).join(' ');

    const result = await run(`mutation { ${champs} }`);

    expect(result.errors?.[0]?.message).toContain('Trop de champs racine');
  });
});

describe('Limite de profondeur', () => {
  it('accepte la profondeur maximale légitime du schéma', async () => {
    // Query → ReviewPage → items → Review → product → Product : 5 niveaux,
    // sous le plafond de 8.
    const result = await run(
      '{ productsReviews(productId: "p1") { items { product { name } } } }',
    );

    expect(result.errors).toBeUndefined();
  });

  it('refuse une requête dépassant le plafond', async () => {
    // Le schéma n'étant pas récursif, aucune requête valide ne peut
    // dépasser 8 niveaux. On exerce donc la règle directement, avec un
    // plafond abaissé — c'est elle qui est testée, pas le schéma.
    const { buildSchema, parse, validate } = await import('graphql');
    const { typeDefs } = await import('../../src/graphql/typeDefs.js');
    const { createDepthLimitRule } = await import('../../src/graphql/limits.js');

    const schema = buildSchema(typeDefs);
    const document = parse(
      '{ productsReviews(productId: "p1") { items { product { name } } } }',
    );

    const erreurs = validate(schema, document, [createDepthLimitRule(2)]);

    expect(erreurs).toHaveLength(1);
    expect(erreurs[0]?.message).toContain('Requête trop profonde');
    expect(erreurs[0]?.message).toContain('maximum 2');
  });

  it('laisse passer la même requête quand le plafond est suffisant', async () => {
    const { buildSchema, parse, validate } = await import('graphql');
    const { typeDefs } = await import('../../src/graphql/typeDefs.js');
    const { createDepthLimitRule } = await import('../../src/graphql/limits.js');

    const schema = buildSchema(typeDefs);
    const document = parse(
      '{ productsReviews(productId: "p1") { items { product { name } } } }',
    );

    expect(validate(schema, document, [createDepthLimitRule(8)])).toHaveLength(0);
  });

  it('suit les fragments pour mesurer la profondeur réelle', async () => {
    // Un fragment ne doit pas servir à contourner la mesure.
    const { buildSchema, parse, validate } = await import('graphql');
    const { typeDefs } = await import('../../src/graphql/typeDefs.js');
    const { createDepthLimitRule } = await import('../../src/graphql/limits.js');

    const schema = buildSchema(typeDefs);
    const document = parse(
      '{ productsReviews(productId: "p1") { items { ...P } } } fragment P on Review { product { name } }',
    );

    const erreurs = validate(schema, document, [createDepthLimitRule(3)]);

    expect(erreurs).toHaveLength(1);
    expect(erreurs[0]?.message).toContain('Requête trop profonde');
  });
});

describe('L’introspection reste accessible', () => {
  it('une requête d’introspection complète passe les deux règles', async () => {
    // Apollo Sandbox envoie une introspection bien plus profonde que le
    // plafond applicatif. Le sujet attend que le correcteur puisse explorer
    // le schéma : elle doit donc être exemptée.
    const result = await run(`{
      __schema {
        queryType { name fields { name args { name type { name kind ofType { name } } } } }
        mutationType { name fields { name } }
        types { name kind fields { name type { name kind ofType { name kind } } } }
      }
    }`);

    expect(result.errors).toBeUndefined();
    expect(result.data?.['__schema']).toBeDefined();
  });

  it('__type reste interrogeable', async () => {
    const result = await run('{ __type(name: "Review") { name fields { name } } }');

    expect(result.errors).toBeUndefined();
  });
});
