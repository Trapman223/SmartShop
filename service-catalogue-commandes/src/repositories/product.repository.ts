import { Prisma } from '@prisma/client';
import type { Product } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import type { Pagination } from '../utils/pagination.js';
import type { ListProductsQuery } from '../validators/product.validator.js';

export interface ProductWriteData {
  reference: string;
  name: string;
  description: string | null;
  price: string;
  stock: number;
}

function buildWhere(filters: ListProductsQuery): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = {};

  if (filters.q !== undefined) {
    where.OR = [
      { name: { contains: filters.q, mode: 'insensitive' } },
      { reference: { contains: filters.q, mode: 'insensitive' } },
      { description: { contains: filters.q, mode: 'insensitive' } },
    ];
  }

  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    where.price = {
      ...(filters.minPrice !== undefined
        ? { gte: new Prisma.Decimal(filters.minPrice) }
        : {}),
      ...(filters.maxPrice !== undefined
        ? { lte: new Prisma.Decimal(filters.maxPrice) }
        : {}),
    };
  }

  if (filters.inStock === true) {
    where.stock = { gt: 0 };
  }

  return where;
}

function buildOrderBy(sort: ListProductsQuery['sort']): Prisma.ProductOrderByWithRelationInput {
  const [field, direction] = sort.split(':');
  return { [String(field)]: direction === 'asc' ? 'asc' : 'desc' };
}

export async function findMany(
  filters: ListProductsQuery,
  pagination: Pagination,
): Promise<{ items: Product[]; total: number }> {
  const where = buildWhere(filters);

  // Transaction en lecture : le décompte et la page proviennent du même
  // instantané, la pagination reste donc cohérente sous écriture concurrente.
  const [items, total] = await prisma.$transaction([
    prisma.product.findMany({
      where,
      orderBy: buildOrderBy(filters.sort),
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.product.count({ where }),
  ]);

  return { items, total };
}

export async function findById(id: string): Promise<Product | null> {
  return prisma.product.findUnique({ where: { id } });
}

export async function findManyByReferences(
  references: readonly string[],
): Promise<Product[]> {
  return prisma.product.findMany({
    where: { reference: { in: [...references] } },
  });
}

export async function create(data: ProductWriteData): Promise<Product> {
  return prisma.product.create({
    data: { ...data, price: new Prisma.Decimal(data.price) },
  });
}

export async function replace(
  id: string,
  data: ProductWriteData,
): Promise<Product> {
  return prisma.product.update({
    where: { id },
    data: { ...data, price: new Prisma.Decimal(data.price) },
  });
}

export async function remove(id: string): Promise<void> {
  await prisma.product.delete({ where: { id } });
}

/** Nombre de lignes de commande référençant ce produit. */
export async function countOrderItems(productId: string): Promise<number> {
  return prisma.orderItem.count({ where: { productId } });
}
