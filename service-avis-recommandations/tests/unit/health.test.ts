import { describe, it, expect, vi } from 'vitest';

// La readiness interroge MongoDB : on isole la couche base de données
// pour que ce test reste purement unitaire (aucun conteneur requis).
vi.mock('../../src/db/mongoose.js', () => ({
  connectWithRetry: vi.fn(),
  disconnectMongoose: vi.fn(),
  isDatabaseReachable: vi.fn().mockReturnValue(true),
}));

const { createApolloServer } = await import('../../src/app.js');

describe('avis-api — schéma GraphQL', () => {
  it('la query health renvoie le statut du service', async () => {
    const apollo = createApolloServer();

    const response = await apollo.executeOperation(
      {
        query: `
          query {
            health {
              status
              service
              database
            }
          }
        `,
      },
      { contextValue: { traceId: 'trace-de-test', customerId: undefined } },
    );

    expect(response.body.kind).toBe('single');
    if (response.body.kind !== 'single') return;

    expect(response.body.singleResult.errors).toBeUndefined();
    expect(response.body.singleResult.data?.['health']).toMatchObject({
      status: 'ok',
      service: 'avis-api',
      database: 'up',
    });

    await apollo.stop();
  });

  it('une query inconnue est rejetée par la validation du schéma', async () => {
    const apollo = createApolloServer();

    const response = await apollo.executeOperation(
      { query: '{ queryInexistante { id } }' },
      { contextValue: { traceId: 'trace-de-test', customerId: undefined } },
    );

    if (response.body.kind !== 'single') return;
    expect(response.body.singleResult.errors).toBeDefined();

    await apollo.stop();
  });
});
