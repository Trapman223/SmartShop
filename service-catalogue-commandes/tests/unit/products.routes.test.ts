import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { makeProduct, PRODUCT_ID, UNKNOWN_ID } from '../helpers/fixtures.js';

// Le repository est simulé : ces tests valident les routes, la validation,
// la sérialisation et les codes de statut, sans PostgreSQL.
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /products', () => {
  it('renvoie 200 avec data et meta de pagination', async () => {
    repo.findMany.mockResolvedValue({ items: [makeProduct()], total: 1 });

    const response = await request(app).get('/products');

    expect(response.status).toBe(200);
    expect(response.body.meta).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
    expect(response.body.data[0]).toMatchObject({
      reference: 'SS-PRD-00001',
      price: '129.90',
      stock: 42,
      available: true,
    });
  });

  it('sérialise le prix en chaîne à deux décimales, jamais en flottant', async () => {
    repo.findMany.mockResolvedValue({
      items: [makeProduct({ price: new Prisma.Decimal('7') })],
      total: 1,
    });

    const response = await request(app).get('/products');

    expect(response.body.data[0].price).toBe('7.00');
    expect(typeof response.body.data[0].price).toBe('string');
  });

  it('marque available à false quand le stock est nul', async () => {
    repo.findMany.mockResolvedValue({
      items: [makeProduct({ stock: 0 })],
      total: 1,
    });

    const response = await request(app).get('/products');

    expect(response.body.data[0].available).toBe(false);
  });

  it('transmet les filtres validés au repository', async () => {
    repo.findMany.mockResolvedValue({ items: [], total: 0 });

    await request(app).get('/products?q=casque&inStock=true&sort=price:asc&limit=5');

    expect(repo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'casque', inStock: true, sort: 'price:asc' }),
      expect.objectContaining({ take: 5, skip: 0 }),
    );
  });

  it('rejette un tri non autorisé en 400', async () => {
    const response = await request(app).get('/products?sort=stock:asc');

    expect(response.status).toBe(400);
    expect(response.body.errors[0].field).toBe('sort');
  });

  it('plafonne limit à 100 via une 400 explicite', async () => {
    const response = await request(app).get('/products?limit=5000');

    expect(response.status).toBe(400);
  });
});

describe('GET /products/:id', () => {
  it('renvoie 200 et le produit', async () => {
    repo.findById.mockResolvedValue(makeProduct());

    const response = await request(app).get(`/products/${PRODUCT_ID}`);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(PRODUCT_ID);
  });

  it('renvoie 404 si le produit n’existe pas', async () => {
    repo.findById.mockResolvedValue(null);

    const response = await request(app).get(`/products/${UNKNOWN_ID}`);

    expect(response.status).toBe(404);
    expect(response.body.title).toBe('Produit introuvable');
    expect(response.body.traceId).toBeDefined();
  });

  it('renvoie 400 si l’identifiant n’est pas un UUID', async () => {
    const response = await request(app).get('/products/pas-un-uuid');

    expect(response.status).toBe(400);
    expect(repo.findById).not.toHaveBeenCalled();
  });
});

describe('GET /products/batch', () => {
  it('résout plusieurs références en un appel', async () => {
    repo.findManyByReferences.mockResolvedValue([makeProduct()]);

    const response = await request(app).get(
      '/products/batch?refs=SS-PRD-00001,SS-PRD-00002',
    );

    expect(response.status).toBe(200);
    expect(repo.findManyByReferences).toHaveBeenCalledWith([
      'SS-PRD-00001',
      'SS-PRD-00002',
    ]);
  });

  it('n’est pas capturée par la route /:id', async () => {
    repo.findManyByReferences.mockResolvedValue([]);

    const response = await request(app).get('/products/batch?refs=SS-PRD-00001');

    expect(response.status).toBe(200);
    expect(repo.findById).not.toHaveBeenCalled();
  });
});

describe('POST /products', () => {
  const body = {
    reference: 'SS-PRD-00042',
    name: 'Nouveau produit',
    price: '19.99',
    stock: 10,
  };

  it('renvoie 201 avec l’en-tête Location', async () => {
    repo.create.mockResolvedValue(makeProduct({ reference: 'SS-PRD-00042' }));

    const response = await request(app).post('/products').send(body);

    expect(response.status).toBe(201);
    expect(response.headers.location).toBe(`/products/${PRODUCT_ID}`);
  });

  it('renvoie 400 et détaille les champs fautifs', async () => {
    const response = await request(app)
      .post('/products')
      .send({ reference: 'ab', name: '', price: '12.345', stock: -3 });

    expect(response.status).toBe(400);
    const champs = response.body.errors.map((e: { field: string }) => e.field);
    expect(champs).toEqual(
      expect.arrayContaining(['reference', 'name', 'price', 'stock']),
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('refuse une référence en minuscules', async () => {
    const response = await request(app)
      .post('/products')
      .send({ ...body, reference: 'ss-prd-00042' });

    expect(response.status).toBe(400);
  });

  it('traduit une violation d’unicité Prisma en 409', async () => {
    repo.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target: ['reference'] },
      }),
    );

    const response = await request(app).post('/products').send(body);

    expect(response.status).toBe(409);
    expect(response.body.detail).toContain('reference');
  });
});

describe('PUT /products/:id', () => {
  it('renvoie 200 après remplacement', async () => {
    repo.findById.mockResolvedValue(makeProduct());
    repo.replace.mockResolvedValue(makeProduct({ name: 'Nom remplacé' }));

    const response = await request(app).put(`/products/${PRODUCT_ID}`).send({
      reference: 'SS-PRD-00001',
      name: 'Nom remplacé',
      price: '99.00',
      stock: 5,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe('Nom remplacé');
  });

  it('efface la description absente (sémantique PUT)', async () => {
    repo.findById.mockResolvedValue(makeProduct());
    repo.replace.mockResolvedValue(makeProduct({ description: null }));

    await request(app).put(`/products/${PRODUCT_ID}`).send({
      reference: 'SS-PRD-00001',
      name: 'Casque',
      price: '99.00',
      stock: 5,
    });

    expect(repo.replace).toHaveBeenCalledWith(
      PRODUCT_ID,
      expect.objectContaining({ description: null }),
    );
  });

  it('renvoie 404 sur un produit inexistant', async () => {
    repo.findById.mockResolvedValue(null);

    const response = await request(app).put(`/products/${UNKNOWN_ID}`).send({
      reference: 'SS-PRD-00001',
      name: 'Casque',
      price: '99.00',
      stock: 5,
    });

    expect(response.status).toBe(404);
  });
});

describe('DELETE /products/:id', () => {
  it('renvoie 204 sans corps', async () => {
    repo.findById.mockResolvedValue(makeProduct());
    repo.countOrderItems.mockResolvedValue(0);
    repo.remove.mockResolvedValue(undefined);

    const response = await request(app).delete(`/products/${PRODUCT_ID}`);

    expect(response.status).toBe(204);
    expect(response.body).toEqual({});
  });

  it('renvoie 409 si le produit est référencé par des commandes', async () => {
    repo.findById.mockResolvedValue(makeProduct());
    repo.countOrderItems.mockResolvedValue(3);

    const response = await request(app).delete(`/products/${PRODUCT_ID}`);

    expect(response.status).toBe(409);
    expect(response.body.detail).toContain('3 ligne(s)');
    expect(repo.remove).not.toHaveBeenCalled();
  });

  it('renvoie 404 sur un produit inexistant', async () => {
    repo.findById.mockResolvedValue(null);

    const response = await request(app).delete(`/products/${UNKNOWN_ID}`);

    expect(response.status).toBe(404);
  });
});
