import { Prisma } from '@prisma/client';
import type { Order, OrderItem, Product } from '@prisma/client';

export const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
export const PRODUCT_ID_2 = '22222222-2222-4222-8222-222222222222';
export const ORDER_ID = '99999999-9999-4999-8999-999999999999';
export const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

export function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: PRODUCT_ID,
    reference: 'SS-PRD-00001',
    name: 'Casque audio sans fil',
    description: 'Réduction de bruit active.',
    price: new Prisma.Decimal('129.90'),
    stock: 42,
    createdAt: new Date('2026-01-15T10:00:00.000Z'),
    updatedAt: new Date('2026-01-15T10:00:00.000Z'),
    ...overrides,
  };
}

export type ItemWithProduct = OrderItem & {
  product: Pick<Product, 'reference' | 'name'> | null;
};

export function makeOrder(
  overrides: Partial<Order> = {},
  items?: ItemWithProduct[],
): Order & { items: ItemWithProduct[] } {
  return {
    id: ORDER_ID,
    customerName: 'Amina Diallo',
    status: 'PENDING',
    total: new Prisma.Decimal('259.80'),
    createdAt: new Date('2026-02-01T09:30:00.000Z'),
    updatedAt: new Date('2026-02-01T09:30:00.000Z'),
    ...overrides,
    items: items ?? [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        orderId: ORDER_ID,
        productId: PRODUCT_ID,
        quantity: 2,
        unitPrice: new Prisma.Decimal('129.90'),
        product: { reference: 'SS-PRD-00001', name: 'Casque audio sans fil' },
      },
    ],
  };
}
