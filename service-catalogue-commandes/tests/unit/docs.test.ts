import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../src/db/prisma.js', () => ({
  prisma: {},
  connectWithRetry: vi.fn(),
  disconnectPrisma: vi.fn(),
  isDatabaseReachable: vi.fn().mockResolvedValue(true),
  isSchemaReady: vi.fn().mockResolvedValue(true),
}));

const { createApp } = await import('../../src/app.js');
const app = createApp();

describe('Documentation OpenAPI', () => {
  it('GET /openapi.json sert une spécification 3.1 valide', async () => {
    const response = await request(app).get('/openapi.json');

    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe('3.1.0');
    expect(response.body.info.title).toContain('Smart-Shop');
  });

  it('documente les trois points de terminaison exigés par le sujet', async () => {
    const response = await request(app).get('/openapi.json');
    const paths = response.body.paths;

    expect(paths['/products'].get).toBeDefined();
    expect(paths['/orders'].post).toBeDefined();
    expect(paths['/orders/{id}'].delete).toBeDefined();
  });

  it('documente les codes d’erreur métier de POST /orders', async () => {
    const response = await request(app).get('/openapi.json');
    const responses = response.body.paths['/orders'].post.responses;

    expect(Object.keys(responses)).toEqual(
      expect.arrayContaining(['201', '400', '404', '409']),
    );
  });

  it('GET /docs sert la page Swagger UI', async () => {
    const response = await request(app).get('/docs');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.text).toContain('/openapi.json');
  });
});

describe('Traduction des erreurs Prisma', () => {
  it('convertit une base injoignable en 503 et non en 500', async () => {
    const { Prisma } = await import('@prisma/client');
    const { translatePrismaError } = await import('../../src/utils/prismaError.js');
    const { ServiceUnavailableError } = await import('../../src/errors/AppError.js');

    const translated = translatePrismaError(
      new Prisma.PrismaClientInitializationError(
        "Can't reach database server",
        '6.19.3',
      ),
    );

    expect(translated).toBeInstanceOf(ServiceUnavailableError);
    expect((translated as InstanceType<typeof ServiceUnavailableError>).status).toBe(503);
  });
});
