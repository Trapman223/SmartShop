import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import {
  makeOrder,
  ORDER_ID,
  PRODUCT_ID,
  PRODUCT_ID_2,
  UNKNOWN_ID,
} from '../helpers/fixtures.js';
import {
  ConflictError,
  InsufficientStockError,
  NotFoundError,
} from '../../src/errors/AppError.js';

const repo = {
  findMany: vi.fn(),
  findById: vi.fn(),
  updateStatus: vi.fn(),
  createWithStockDecrement: vi.fn(),
  deleteWithStockRestore: vi.fn(),
};
vi.mock('../../src/repositories/order.repository.js', () => repo);
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

describe('GET /orders', () => {
  it('renvoie 200 avec les lignes et le total sérialisé', async () => {
    repo.findMany.mockResolvedValue({ items: [makeOrder()], total: 1 });

    const response = await request(app).get('/orders');

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({
      customerName: 'Amina Diallo',
      status: 'PENDING',
      total: '259.80',
    });
    expect(response.body.data[0].items[0]).toMatchObject({
      productReference: 'SS-PRD-00001',
      quantity: 2,
      unitPrice: '129.90',
      subtotal: '259.80',
    });
  });

  it('transmet le filtre de statut au repository', async () => {
    repo.findMany.mockResolvedValue({ items: [], total: 0 });

    await request(app).get('/orders?status=SHIPPED');

    expect(repo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'SHIPPED' }),
      expect.anything(),
    );
  });

  it('rejette un statut inconnu en 400', async () => {
    const response = await request(app).get('/orders?status=LIVREE');

    expect(response.status).toBe(400);
    expect(repo.findMany).not.toHaveBeenCalled();
  });
});

describe('GET /orders/:id', () => {
  it('renvoie 200 et la commande', async () => {
    repo.findById.mockResolvedValue(makeOrder());

    const response = await request(app).get(`/orders/${ORDER_ID}`);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(ORDER_ID);
  });

  it('renvoie 404 si la commande n’existe pas', async () => {
    repo.findById.mockResolvedValue(null);

    const response = await request(app).get(`/orders/${UNKNOWN_ID}`);

    expect(response.status).toBe(404);
  });
});

describe('POST /orders', () => {
  const body = {
    customerName: 'Amina Diallo',
    items: [{ productId: PRODUCT_ID, quantity: 2 }],
  };

  it('renvoie 201 avec la commande créée et son en-tête Location', async () => {
    repo.createWithStockDecrement.mockResolvedValue(makeOrder());

    const response = await request(app).post('/orders').send(body);

    expect(response.status).toBe(201);
    expect(response.headers.location).toBe(`/orders/${ORDER_ID}`);
    expect(response.body.data.total).toBe('259.80');
    expect(response.body.data.status).toBe('PENDING');
  });

  it('délègue la création à la transaction du repository', async () => {
    repo.createWithStockDecrement.mockResolvedValue(makeOrder());

    await request(app).post('/orders').send(body);

    expect(repo.createWithStockDecrement).toHaveBeenCalledWith({
      customerName: 'Amina Diallo',
      items: [{ productId: PRODUCT_ID, quantity: 2 }],
    });
  });

  it('renvoie 409 quand le stock est insuffisant', async () => {
    repo.createWithStockDecrement.mockRejectedValue(
      new InsufficientStockError(
        'Stock insuffisant',
        'SS-PRD-00001 : 1 disponible(s), 2 demandé(s)',
      ),
    );

    const response = await request(app).post('/orders').send(body);

    expect(response.status).toBe(409);
    expect(response.body.title).toBe('Stock insuffisant');
    expect(response.body.detail).toContain('SS-PRD-00001');
    expect(response.body.type).toContain('insufficient_stock');
  });

  it('renvoie 404 quand un produit demandé n’existe pas', async () => {
    repo.createWithStockDecrement.mockRejectedValue(
      new NotFoundError('Produit introuvable', UNKNOWN_ID),
    );

    const response = await request(app)
      .post('/orders')
      .send({ customerName: 'Test', items: [{ productId: UNKNOWN_ID, quantity: 1 }] });

    expect(response.status).toBe(404);
  });

  it('rejette une commande sans ligne', async () => {
    const response = await request(app)
      .post('/orders')
      .send({ customerName: 'Amina Diallo', items: [] });

    expect(response.status).toBe(400);
    expect(repo.createWithStockDecrement).not.toHaveBeenCalled();
  });

  it('rejette une quantité nulle ou négative', async () => {
    const response = await request(app)
      .post('/orders')
      .send({ customerName: 'Amina', items: [{ productId: PRODUCT_ID, quantity: 0 }] });

    expect(response.status).toBe(400);
    expect(response.body.errors[0].field).toBe('items.0.quantity');
  });

  it('rejette un productId qui n’est pas un UUID', async () => {
    const response = await request(app)
      .post('/orders')
      .send({ customerName: 'Amina', items: [{ productId: 'abc', quantity: 1 }] });

    expect(response.status).toBe(400);
  });

  it('rejette un nom de client vide', async () => {
    const response = await request(app)
      .post('/orders')
      .send({ customerName: '   ', items: [{ productId: PRODUCT_ID, quantity: 1 }] });

    expect(response.status).toBe(400);
  });

  it('accepte plusieurs lignes distinctes', async () => {
    repo.createWithStockDecrement.mockResolvedValue(makeOrder());

    const response = await request(app).post('/orders').send({
      customerName: 'Amina Diallo',
      items: [
        { productId: PRODUCT_ID, quantity: 2 },
        { productId: PRODUCT_ID_2, quantity: 1 },
      ],
    });

    expect(response.status).toBe(201);
  });
});

describe('DELETE /orders/:id', () => {
  it('renvoie 204 après restitution du stock', async () => {
    repo.deleteWithStockRestore.mockResolvedValue(undefined);

    const response = await request(app).delete(`/orders/${ORDER_ID}`);

    expect(response.status).toBe(204);
    expect(repo.deleteWithStockRestore).toHaveBeenCalledWith(ORDER_ID);
  });

  it('renvoie 404 si la commande n’existe pas', async () => {
    repo.deleteWithStockRestore.mockRejectedValue(
      new NotFoundError('Commande introuvable'),
    );

    const response = await request(app).delete(`/orders/${UNKNOWN_ID}`);

    expect(response.status).toBe(404);
  });

  it('renvoie 409 sur une commande déjà expédiée', async () => {
    repo.deleteWithStockRestore.mockRejectedValue(
      new ConflictError(
        'Commande déjà expédiée',
        'Une commande expédiée ne peut pas être supprimée.',
      ),
    );

    const response = await request(app).delete(`/orders/${ORDER_ID}`);

    expect(response.status).toBe(409);
    expect(response.body.title).toBe('Commande déjà expédiée');
  });

  it('renvoie 400 si l’identifiant n’est pas un UUID', async () => {
    const response = await request(app).delete('/orders/pas-un-uuid');

    expect(response.status).toBe(400);
    expect(repo.deleteWithStockRestore).not.toHaveBeenCalled();
  });
});

describe('PATCH /orders/:id/status', () => {
  it('autorise PENDING → CONFIRMED', async () => {
    repo.findById.mockResolvedValue(makeOrder({ status: 'PENDING' }));
    repo.updateStatus.mockResolvedValue(makeOrder({ status: 'CONFIRMED' }));

    const response = await request(app)
      .patch(`/orders/${ORDER_ID}/status`)
      .send({ status: 'CONFIRMED' });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('CONFIRMED');
  });

  it('refuse PENDING → SHIPPED en 409', async () => {
    repo.findById.mockResolvedValue(makeOrder({ status: 'PENDING' }));

    const response = await request(app)
      .patch(`/orders/${ORDER_ID}/status`)
      .send({ status: 'SHIPPED' });

    expect(response.status).toBe(409);
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it('refuse toute transition depuis SHIPPED (statut terminal)', async () => {
    repo.findById.mockResolvedValue(makeOrder({ status: 'SHIPPED' }));

    const response = await request(app)
      .patch(`/orders/${ORDER_ID}/status`)
      .send({ status: 'CANCELLED' });

    expect(response.status).toBe(409);
  });

  it('est idempotent quand le statut est déjà celui demandé', async () => {
    repo.findById.mockResolvedValue(makeOrder({ status: 'CONFIRMED' }));

    const response = await request(app)
      .patch(`/orders/${ORDER_ID}/status`)
      .send({ status: 'CONFIRMED' });

    expect(response.status).toBe(200);
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });
});
