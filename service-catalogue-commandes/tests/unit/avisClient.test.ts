import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import {
  fetchProductRatings,
  RATINGS_BATCH_LIMIT,
} from '../../src/clients/avis.client.js';
import { UpstreamError } from '../../src/errors/AppError.js';
import { makeProduct } from '../helpers/fixtures.js';

/**
 * Flux 2 — `catalogue-api` → `avis-api`.
 *
 * Deux niveaux : le contrat du client GraphQL, puis l'effet observable sur
 * `GET /products`, y compris le mode dégradé exigé par CLAUDE.md section 2.
 */

const repo = {
  findMany: vi.fn(),
  findById: vi.fn(),
  findManyByReferences: vi.fn(),
  create: vi.fn(),
  replace: vi.fn(),
  remove: vi.fn(),
  countOrderItems: vi.fn(),
};
vi.mock('../../src/repositories/product.repository.js', () => repo);
vi.mock('../../src/db/prisma.js', () => ({
  prisma: {},
  connectWithRetry: vi.fn(),
  disconnectPrisma: vi.fn(),
  isDatabaseReachable: vi.fn().mockResolvedValue(true),
  isSchemaReady: vi.fn().mockResolvedValue(true),
}));

const { createApp } = await import('../../src/app.js');
const app = createApp();

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  // Remplace le stub « réseau interdit » posé par tests/setup.ts.
  vi.stubGlobal('fetch', fetchMock);
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function ratingsResponse(
  ratings: { productId: string; average: number; count: number }[],
): Response {
  return jsonResponse({ data: { productRatings: ratings } });
}

describe('fetchProductRatings — appel sortant', () => {
  it('poste une query GraphQL batchée et propage X-Request-Id', async () => {
    fetchMock.mockResolvedValue(ratingsResponse([]));

    await fetchProductRatings(['SS-PRD-00001', 'SS-PRD-00002'], 'trace-7');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe('http://localhost:4000/graphql');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-request-id']).toBe('trace-7');

    const body = JSON.parse(init.body as string) as {
      query: string;
      variables: { productIds: string[] };
    };
    // Une seule requête pour toute la page : pas de N+1 vers avis-api.
    expect(body.variables.productIds).toEqual(['SS-PRD-00001', 'SS-PRD-00002']);
    expect(body.query).toContain('productRatings');
  });

  it('n’émet aucun appel réseau pour une liste vide', async () => {
    const result = await fetchProductRatings([], 'trace');

    expect(result.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('indexe les notes par référence', async () => {
    fetchMock.mockResolvedValue(
      ratingsResponse([{ productId: 'SS-PRD-00001', average: 4.5, count: 12 }]),
    );

    const result = await fetchProductRatings(['SS-PRD-00001'], 'trace');

    expect(result.get('SS-PRD-00001')).toEqual({ average: 4.5, count: 12 });
  });

  it('refuse un lot au-delà du plafond, sans appeler le réseau', async () => {
    const references = Array.from(
      { length: RATINGS_BATCH_LIMIT + 1 },
      (_unused, index) => `SS-PRD-${String(index).padStart(5, '0')}`,
    );

    await expect(fetchProductRatings(references, 'trace')).rejects.toBeInstanceOf(
      UpstreamError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('fetchProductRatings — pannes amont', () => {
  it('traduit un dépassement de délai en UpstreamError', async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }),
    );

    await expect(
      fetchProductRatings(['SS-PRD-00001'], 'trace'),
    ).rejects.toMatchObject({ status: 502, code: 'UPSTREAM_ERROR' });
  });

  it('traduit un statut non 2xx en UpstreamError', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 503));

    await expect(
      fetchProductRatings(['SS-PRD-00001'], 'trace'),
    ).rejects.toBeInstanceOf(UpstreamError);
  });

  it('détecte une erreur GraphQL renvoyée avec un statut 200', async () => {
    // GraphQL répond 200 même en erreur : le statut HTTP ne suffit pas.
    fetchMock.mockResolvedValue(
      jsonResponse({ errors: [{ message: 'Cannot query field "productRatings"' }] }),
    );

    await expect(
      fetchProductRatings(['SS-PRD-00001'], 'trace'),
    ).rejects.toBeInstanceOf(UpstreamError);
  });

  it('rejette une réponse hors contrat', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: { productRatings: [{ productId: 'X', average: 'bien' }] } }),
    );

    await expect(
      fetchProductRatings(['SS-PRD-00001'], 'trace'),
    ).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe('GET /products — enrichissement par les notes', () => {
  it('ajoute la note moyenne à chaque produit', async () => {
    repo.findMany.mockResolvedValue({
      items: [makeProduct({ reference: 'SS-PRD-00001' })],
      total: 1,
    });
    fetchMock.mockResolvedValue(
      ratingsResponse([{ productId: 'SS-PRD-00001', average: 4.5, count: 12 }]),
    );

    const response = await request(app).get('/products');

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({
      reference: 'SS-PRD-00001',
      rating: { average: 4.5, count: 12 },
    });
  });

  it('renvoie rating: null pour un produit sans avis', async () => {
    repo.findMany.mockResolvedValue({
      items: [makeProduct({ reference: 'SS-PRD-00001' })],
      total: 1,
    });
    fetchMock.mockResolvedValue(ratingsResponse([]));

    const response = await request(app).get('/products');

    expect(response.status).toBe(200);
    expect(response.body.data[0].rating).toBeNull();
  });

  it('reste disponible en 200 avec rating: null quand avis-api est down', async () => {
    repo.findMany.mockResolvedValue({
      items: [makeProduct({ reference: 'SS-PRD-00001' })],
      total: 1,
    });
    fetchMock.mockRejectedValue(new Error('fetch failed'));

    const response = await request(app).get('/products');

    // Cœur du mode dégradé : la panne du service d'avis ne doit JAMAIS
    // rendre le catalogue indisponible (cf. CLAUDE.md section 11, règle 6).
    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({
      reference: 'SS-PRD-00001',
      price: '129.90',
      rating: null,
    });
  });

  it('survit à un dépassement du délai de 800 ms', async () => {
    repo.findMany.mockResolvedValue({ items: [makeProduct()], total: 1 });
    fetchMock.mockRejectedValue(
      Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }),
    );

    const response = await request(app).get('/products');

    expect(response.status).toBe(200);
    expect(response.body.data[0].rating).toBeNull();
  });

  it('n’appelle pas avis-api quand la page est vide', async () => {
    repo.findMany.mockResolvedValue({ items: [], total: 0 });

    const response = await request(app).get('/products');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
