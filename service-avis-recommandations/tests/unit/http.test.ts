import { describe, it, expect, vi, afterAll } from 'vitest';
import request from 'supertest';

// La readiness interroge MongoDB : on isole la couche base de données.
vi.mock('../../src/db/mongoose.js', () => ({
  connectWithRetry: vi.fn(),
  disconnectMongoose: vi.fn(),
  isDatabaseReachable: vi.fn().mockReturnValue(false),
}));

const { createApolloServer, createApp } = await import('../../src/app.js');

// Ce test monte réellement l'application Express + le middleware Apollo.
// Il protège contre les erreurs de câblage ESM/CJS que le typage ne voit pas
// (ex. un import nommé depuis un module CommonJS).
const apollo = createApolloServer();
const app = await createApp(apollo);

afterAll(async () => {
  await apollo.stop();
});

describe('avis-api — application HTTP', () => {
  it('GET /health répond 200', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', service: 'avis-api' });
  });

  it('GET /ready répond 503 quand MongoDB est injoignable', async () => {
    const response = await request(app).get('/ready');

    expect(response.status).toBe(503);
    expect(response.body.checks.mongodb).toBe('down');
  });

  it('POST /graphql exécute la query health via le middleware Apollo', async () => {
    const response = await request(app)
      .post('/graphql')
      .send({ query: '{ health { status service database } }' });

    expect(response.status).toBe(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.health).toMatchObject({
      status: 'ok',
      service: 'avis-api',
      database: 'down',
    });
  });
});

describe('avis-api — en-têtes de sécurité', () => {
  it('sont posés sur toutes les réponses', async () => {
    const response = await request(app).get('/health');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['permissions-policy']).toContain('camera=()');
  });

  it('n’exposent pas la technologie du serveur', async () => {
    const response = await request(app).get('/health');

    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('sont posés aussi sur /graphql', async () => {
    const response = await request(app)
      .post('/graphql')
      .send({ query: '{ health { status } }' });

    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('avis-api — CORS', () => {
  it('renvoie « * » littéral, pas l’origine de l’appelant', async () => {
    // `origin: true` dans le middleware cors renverrait l'origine reçue.
    // Avec « * » configuré, on veut un « * » littéral : l'intention est
    // explicite et aucun site tiers n'est implicitement reconnu.
    const response = await request(app)
      .get('/health')
      .set('Origin', 'https://site-tiers.example');

    expect(response.headers['access-control-allow-origin']).toBe('*');
  });

  it('n’autorise pas l’envoi de credentials', async () => {
    const response = await request(app)
      .get('/health')
      .set('Origin', 'https://site-tiers.example');

    // Un « * » combiné à allow-credentials est refusé par les navigateurs ;
    // l'en-tête ne doit tout simplement pas être émis.
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });
});
