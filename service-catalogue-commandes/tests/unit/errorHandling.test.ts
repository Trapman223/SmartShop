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

const VALID_BODY = {
  reference: 'SS-PRD-00042',
  name: 'Produit',
  price: '19.99',
  stock: 10,
};

describe('Erreurs de corps de requête', () => {
  it('un JSON malformé donne 400, pas 500', async () => {
    const response = await request(app)
      .post('/products')
      .set('content-type', 'application/json')
      .send('{"reference":');

    expect(response.status).toBe(400);
    expect(response.body.title).toBe('Corps de requête JSON invalide');
    expect(response.body.type).toContain('validation_error');
  });

  it('un corps dépassant la limite donne 413, pas 500', async () => {
    const response = await request(app)
      .post('/products')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ ...VALID_BODY, name: 'x'.repeat(2_000_000) }));

    expect(response.status).toBe(413);
    expect(response.body.type).toContain('payload_too_large');
  });

  it('toute erreur porte un traceId corrélable dans les logs', async () => {
    const response = await request(app)
      .post('/products')
      .set('content-type', 'application/json')
      .set('x-request-id', 'trace-connue')
      .send('{cassé');

    expect(response.body.traceId).toBe('trace-connue');
  });
});

describe('Traduction des erreurs body-parser', () => {
  it('laisse passer une erreur qui ne vient pas de body-parser', async () => {
    const { translateBodyParserError } = await import('../../src/utils/httpError.js');
    const original = new Error('erreur quelconque');

    expect(translateBodyParserError(original)).toBe(original);
  });

  it('ignore les valeurs non objet', async () => {
    const { translateBodyParserError } = await import('../../src/utils/httpError.js');

    expect(translateBodyParserError(null)).toBeNull();
    expect(translateBodyParserError('texte')).toBe('texte');
  });

  it('traduit un encodage non supporté en 400', async () => {
    const { translateBodyParserError } = await import('../../src/utils/httpError.js');
    const { ValidationError } = await import('../../src/errors/AppError.js');

    const translated = translateBodyParserError({ type: 'encoding.unsupported' });

    expect(translated).toBeInstanceOf(ValidationError);
  });

  it('traduit une requête interrompue en 400', async () => {
    const { translateBodyParserError } = await import('../../src/utils/httpError.js');
    const { ValidationError } = await import('../../src/errors/AppError.js');

    expect(translateBodyParserError({ type: 'request.aborted' })).toBeInstanceOf(
      ValidationError,
    );
  });

  it('reprend la limite annoncée par body-parser dans le détail', async () => {
    const { translateBodyParserError } = await import('../../src/utils/httpError.js');
    const { PayloadTooLargeError } = await import('../../src/errors/AppError.js');

    const translated = translateBodyParserError({
      type: 'entity.too.large',
      limit: 1048576,
    });

    expect(translated).toBeInstanceOf(PayloadTooLargeError);
    expect((translated as InstanceType<typeof PayloadTooLargeError>).detail).toContain(
      '1048576',
    );
  });
});

describe('En-têtes de sécurité', () => {
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

  it('sont posés même sur une réponse d’erreur', async () => {
    const response = await request(app).get('/route-inconnue');

    expect(response.status).toBe(404);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});
