import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// La readiness interroge PostgreSQL : on isole la couche base de données
// pour que ce test reste purement unitaire (aucun conteneur requis).
vi.mock('../../src/db/prisma.js', () => ({
  prisma: {},
  connectWithRetry: vi.fn(),
  disconnectPrisma: vi.fn(),
  isDatabaseReachable: vi.fn().mockResolvedValue(true),
  isSchemaReady: vi.fn().mockResolvedValue(true),
}));

const { createApp } = await import('../../src/app.js');
const app = createApp();

describe('catalogue-api — sondes de santé', () => {
  it('GET /health répond 200 avec le nom du service', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      service: 'catalogue-api',
    });
  });

  it('GET /health propage X-Request-Id', async () => {
    const response = await request(app)
      .get('/health')
      .set('x-request-id', 'trace-de-test');

    expect(response.headers['x-request-id']).toBe('trace-de-test');
  });

  it('GET /ready répond 200 quand PostgreSQL est joignable', async () => {
    const response = await request(app).get('/ready');

    expect(response.status).toBe(200);
    expect(response.body.checks.postgresql).toBe('up');
  });

  it('une route inconnue répond 404 au format RFC 7807', async () => {
    const response = await request(app).get('/route-inexistante');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ status: 404, title: 'Route inconnue' });
  });
});

describe('catalogue-api — sondes de readiness', () => {
  it('GET /ready répond 200 quand la base répond ET que le schéma existe', async () => {
    const response = await request(app).get('/ready');

    expect(response.status).toBe(200);
    expect(response.body.checks).toEqual({ postgresql: 'up', schema: 'ready' });
  });

  it('GET /ready répond 503 quand PostgreSQL est injoignable', async () => {
    const { isDatabaseReachable } = await import('../../src/db/prisma.js');
    vi.mocked(isDatabaseReachable).mockResolvedValueOnce(false);

    const response = await request(app).get('/ready');

    expect(response.status).toBe(503);
    expect(response.body.checks.postgresql).toBe('down');
    expect(response.body.checks.schema).toBe('unknown');
  });

  it('GET /ready répond 503 si la base répond mais que les tables manquent', async () => {
    // Cas réel sous Swarm : le replica démarre avant que le service de
    // migration n'ait appliqué le schéma. `SELECT 1` réussirait, mais
    // /products et /orders échoueraient — le replica ne doit pas être
    // déclaré prêt.
    const { isSchemaReady } = await import('../../src/db/prisma.js');
    vi.mocked(isSchemaReady).mockResolvedValueOnce(false);

    const response = await request(app).get('/ready');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('not-ready');
    expect(response.body.checks).toEqual({ postgresql: 'up', schema: 'pending' });
  });

  it('n’interroge pas le schéma si la base est injoignable', async () => {
    const { isDatabaseReachable, isSchemaReady } = await import('../../src/db/prisma.js');
    vi.mocked(isDatabaseReachable).mockResolvedValueOnce(false);
    vi.mocked(isSchemaReady).mockClear();

    await request(app).get('/ready');

    expect(isSchemaReady).not.toHaveBeenCalled();
  });
});
