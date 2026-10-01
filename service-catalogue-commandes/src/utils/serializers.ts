import type { Order, OrderItem, Product } from '@prisma/client';
import { toMoneyString } from './money.js';
import type { MoneyString } from './money.js';

/** Représentation JSON d'un produit. */
export interface ProductDto {
  id: string;
  reference: string;
  name: string;
  description: string | null;
  price: MoneyString;
  stock: number;
  available: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItemDto {
  id: string;
  productId: string;
  productReference: string | null;
  productName: string | null;
  quantity: number;
  unitPrice: MoneyString;
  subtotal: MoneyString;
}

export interface OrderDto {
  id: string;
  customerName: string;
  status: Order['status'];
  total: MoneyString;
  items: OrderItemDto[];
  createdAt: string;
  updatedAt: string;
}

export function toProductDto(product: Product): ProductDto {
  return {
    id: product.id,
    reference: product.reference,
    name: product.name,
    description: product.description,
    price: toMoneyString(product.price),
    stock: product.stock,
    available: product.stock > 0,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

type OrderItemWithProduct = OrderItem & {
  product?: Pick<Product, 'reference' | 'name'> | null;
};

export function toOrderItemDto(item: OrderItemWithProduct): OrderItemDto {
  return {
    id: item.id,
    productId: item.productId,
    productReference: item.product?.reference ?? null,
    productName: item.product?.name ?? null,
    quantity: item.quantity,
    unitPrice: toMoneyString(item.unitPrice),
    subtotal: toMoneyString(item.unitPrice.mul(item.quantity)),
  };
}

export function toOrderDto(
  order: Order & { items: OrderItemWithProduct[] },
): OrderDto {
  return {
    id: order.id,
    customerName: order.customerName,
    status: order.status,
    total: toMoneyString(order.total),
    items: order.items.map(toOrderItemDto),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}
