import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BATCH_LIMIT,
  fetchProductsByReferences,
} from '../../src/clients/catalogue.client.js';
import { createProductLoader } from '../../src/clients/product.loader.js';
import { UpstreamError } from '../../src/errors/AppError.js';
import { makeCatalogueProduct } from '../helpers/fixtures.js';

/**
 * Flux 1 — `avis-api` → `catalogue-api`.
 *
 * `fetch` est remplacé : ces tests vérifient le contrat du client (URL,
 * en-têtes, validation de la réponse, traduction des pannes) sans qu'aucun
 * catalogue réel ne tourne.
 */

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('fetchProductsByReferences — appel sortant', () => {
  it('interroge GET /products/batch et propage X-Request-Id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));

    await fetchProductsByReferences(['SS-PRD-00001', 'SS-PRD-00002'], 'trace-42');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe(
      'http://localhost:3000/products/batch?refs=SS-PRD-00001%2CSS-PRD-00002',
    );
    // La trace doit traverser la frontière du service : sans elle, les logs
    // des 6 replicas ne sont plus corrélables dans Portainer.
    expect((init.headers as Record<string, string>)['x-request-id']).toBe('trace-42');
    expect(init.signal).toBeDefined();
  });

  it('n’émet aucun appel réseau pour une liste vide', async () => {
    const result = await fetchProductsByReferences([], 'trace');

    expect(result.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('indexe les produits par référence', async () => {
    const product = makeCatalogueProduct({ reference: 'SS-PRD-00001' });
    fetchMock.mockResolvedValue(jsonResponse({ data: [product] }));

    const result = await fetchProductsByReferences(['SS-PRD-00001'], 'trace');

    expect(result.get('SS-PRD-00001')).toMatchObject({
      reference: 'SS-PRD-00001',
      name: product.name,
      price: product.price,
    });
  });

  it('écarte les champs hors contrat renvoyés par le catalogue', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: [{ ...makeCatalogueProduct(), createdAt: '2026-01-01', secret: 'x' }],
      }),
    );

    const result = await fetchProductsByReferences(['SS-PRD-00001'], 'trace');
    const product = result.get('SS-PRD-00001');

    expect(product).toBeDefined();
    expect(product).not.toHaveProperty('createdAt');
    expect(product).not.toHaveProperty('secret');
  });
});

describe('fetchProductsByReferences — pannes amont', () => {
  it('traduit un dépassement de délai en UpstreamError', async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }),
    );

    await expect(
      fetchProductsByReferences(['SS-PRD-00001'], 'trace'),
    ).rejects.toBeInstanceOf(UpstreamError);
  });

  it('traduit une connexion refusée en UpstreamError', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'));

    await expect(
      fetchProductsByReferences(['SS-PRD-00001'], 'trace'),
    ).rejects.toMatchObject({ status: 502, code: 'UPSTREAM_ERROR' });
  });

  it('traduit un statut non 2xx en UpstreamError', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'boom' }, 500));

    await expect(
      fetchProductsByReferences(['SS-PRD-00001'], 'trace'),
    ).rejects.toBeInstanceOf(UpstreamError);
  });

  it('rejette une réponse qui ne respecte pas le contrat', async () => {
    // `price` numérique au lieu d'une chaîne : contrat rompu côté catalogue.
    fetchMock.mockResolvedValue(
      jsonResponse({ data: [{ ...makeCatalogueProduct(), price: 149.9 }] }),
    );

    await expect(
      fetchProductsByReferences(['SS-PRD-00001'], 'trace'),
    ).rejects.toBeInstanceOf(UpstreamError);
  });

  it('rejette un corps de réponse illisible', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error('Unexpected token')),
    } as unknown as Response);

    await expect(
      fetchProductsByReferences(['SS-PRD-00001'], 'trace'),
    ).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe('createProductLoader — batching et mode dégradé', () => {
  it('regroupe plusieurs résolutions en un seul appel HTTP (pas de N+1)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: [
          makeCatalogueProduct({ reference: 'SS-PRD-00001', name: 'Casque' }),
          makeCatalogueProduct({ reference: 'SS-PRD-00002', name: 'Clavier' }),
        ],
      }),
    );

    const loader = createProductLoader('trace');

    const [a, b, c] = await Promise.all([
      loader.load('SS-PRD-00001'),
      loader.load('SS-PRD-00002'),
      loader.load('SS-PRD-00001'),
    ]);

    // Trois résolutions, un seul aller-retour réseau : c'est précisément ce
    // que le sujet attend d'un resolver GraphQL correctement batché.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a?.name).toBe('Casque');
    expect(b?.name).toBe('Clavier');
    expect(c?.name).toBe('Casque');
  });

  it('renvoie null pour une référence inconnue du catalogue', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));

    const loader = createProductLoader('trace');

    await expect(loader.load('SS-PRD-INCONNU')).resolves.toBeNull();
  });

  it('dégrade en null sans propager l’erreur quand catalogue-api est down', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'));

    const loader = createProductLoader('trace');

    // Le loader absorbe la panne : c'est ce qui permet à la requête GraphQL
    // d'aboutir malgré l'indisponibilité du catalogue.
    await expect(loader.load('SS-PRD-00001')).resolves.toBeNull();
  });

  it('découpe les lots au plafond accepté par le catalogue', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));

    const loader = createProductLoader('trace');
    const references = Array.from(
      { length: BATCH_LIMIT + 1 },
      (_unused, index) => `SS-PRD-${String(index).padStart(5, '0')}`,
    );

    await Promise.all(references.map((reference) => loader.load(reference)));

    // 101 références → 2 appels : le catalogue en refuse plus de 100 d'un coup.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
