import { Prisma } from '@prisma/client';
import type { Order, OrderItem, OrderStatus, Product } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { buildOrderLines, mergeRequestedItems } from '../utils/orderCalculation.js';
import type { LockedProduct, RequestedItem } from '../utils/orderCalculation.js';
import { ConflictError, NotFoundError } from '../errors/AppError.js';
import type { Pagination } from '../utils/pagination.js';
import type { ListOrdersQuery } from '../validators/order.validator.js';

export type OrderWithItems = Order & {
  items: (OrderItem & { product: Pick<Product, 'reference' | 'name'> | null })[];
};

const includeItems = {
  items: {
    include: { product: { select: { reference: true, name: true } } },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.OrderInclude;

export async function findMany(
  filters: ListOrdersQuery,
  pagination: Pagination,
): Promise<{ items: OrderWithItems[]; total: number }> {
  const where: Prisma.OrderWhereInput = {
    ...(filters.status !== undefined ? { status: filters.status } : {}),
    ...(filters.customerName !== undefined
      ? { customerName: { contains: filters.customerName, mode: 'insensitive' } }
      : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      include: includeItems,
      orderBy: { createdAt: 'desc' },
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.order.count({ where }),
  ]);

  return { items, total };
}

export async function findById(id: string): Promise<OrderWithItems | null> {
  return prisma.order.findUnique({ where: { id }, include: includeItems });
}

export async function updateStatus(
  id: string,
  status: OrderStatus,
): Promise<OrderWithItems> {
  return prisma.order.update({
    where: { id },
    data: { status },
    include: includeItems,
  });
}

/**
 * Création d'une commande — les sept étapes exigées, dans UNE transaction.
 *
 * ⚠️ Point le plus sensible du service. Avec 3 replicas concurrents, un
 * simple `findMany` puis `update` laisserait une fenêtre de compétition :
 * deux requêtes pourraient lire le même stock de 1 et le décrémenter toutes
 * les deux. Le verrou pessimiste `SELECT ... FOR UPDATE` sérialise les
 * accès aux lignes produits concernées pour toute la durée de la
 * transaction.
 *
 * Prisma n'exposant pas `FOR UPDATE` dans son API fluide, le verrou est
 * posé en SQL brut via `$queryRaw` (cf. CLAUDE.md section 3).
 *
 * `ORDER BY id` est obligatoire : sans ordre déterministe, deux commandes
 * portant sur les mêmes produits dans un ordre différent peuvent
 * s'interbloquer.
 */
export async function createWithStockDecrement(input: {
  customerName: string;
  items: readonly RequestedItem[];
}): Promise<OrderWithItems> {
  const merged = mergeRequestedItems(input.items);
  const productIds = merged.map((item) => item.productId).sort();

  return prisma.$transaction(
    async (tx) => {
      // Étapes 1-2 (verrou) : les lignes produits sont verrouillées jusqu'au
      // COMMIT. Toute transaction concurrente portant sur les mêmes produits
      // attend ici.
      const locked = await tx.$queryRaw<LockedProduct[]>`
        SELECT id, reference, name, price, stock
        FROM products
        WHERE id = ANY(${productIds}::uuid[])
        ORDER BY id
        FOR UPDATE
      `;

      // Étapes 1-3 : existence des produits, stock suffisant, calcul du total.
      const { lines, total } = buildOrderLines(locked, merged);

      // Étape 6 : décrément du stock, sous protection du verrou.
      for (const line of lines) {
        await tx.product.update({
          where: { id: line.productId },
          data: { stock: { decrement: line.quantity } },
        });
      }

      // Étapes 4-5 : création de la commande et de ses lignes.
      return tx.order.create({
        data: {
          customerName: input.customerName,
          total,
          items: {
            create: lines.map((line) => ({
              productId: line.productId,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
            })),
          },
        },
        include: includeItems,
      });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: 10_000,
    },
  );
}

/**
 * Suppression d'une commande avec restitution du stock, dans une transaction.
 *
 * Une commande déjà expédiée ne peut plus être annulée : les marchandises
 * sont parties, restituer le stock fausserait l'inventaire.
 * Une commande déjà annulée a déjà rendu son stock : on ne le rend pas deux fois.
 */
export async function deleteWithStockRestore(id: string): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        include: { items: true },
      });

      if (order === null) {
        throw new NotFoundError(
          'Commande introuvable',
          `Aucune commande ne correspond à l’identifiant ${id}.`,
        );
      }

      if (order.status === 'SHIPPED') {
        throw new ConflictError(
          'Commande déjà expédiée',
          'Une commande expédiée ne peut pas être supprimée : le stock ne doit pas être restitué.',
        );
      }

      if (order.status !== 'CANCELLED') {
        for (const item of order.items) {
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity } },
          });
        }
      }

      // Les lignes de commande partent en cascade (onDelete: Cascade).
      await tx.order.delete({ where: { id } });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: 10_000,
    },
  );
}
