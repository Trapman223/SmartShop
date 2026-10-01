import * as orderRepository from '../repositories/order.repository.js';
import { ConflictError, NotFoundError } from '../errors/AppError.js';
import { buildMeta, buildPagination } from '../utils/pagination.js';
import type { PaginationMeta } from '../utils/pagination.js';
import { toOrderDto } from '../utils/serializers.js';
import type { OrderDto } from '../utils/serializers.js';
import type {
  CreateOrderInput,
  ListOrdersQuery,
  OrderStatusInput,
} from '../validators/order.validator.js';

/** Transitions de statut autorisées. */
const ALLOWED_TRANSITIONS: Record<OrderStatusInput, readonly OrderStatusInput[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: [],
  CANCELLED: [],
};

export async function listOrders(
  query: ListOrdersQuery,
): Promise<{ data: OrderDto[]; meta: PaginationMeta }> {
  const pagination = buildPagination(query.page, query.limit);
  const { items, total } = await orderRepository.findMany(query, pagination);

  return {
    data: items.map(toOrderDto),
    meta: buildMeta(pagination, total),
  };
}

export async function getOrderById(id: string): Promise<OrderDto> {
  const order = await orderRepository.findById(id);

  if (order === null) {
    throw new NotFoundError(
      'Commande introuvable',
      `Aucune commande ne correspond à l’identifiant ${id}.`,
    );
  }

  return toOrderDto(order);
}

/**
 * Création d'une commande.
 * Les vérifications métier (existence des produits, stock) ne sont pas faites
 * ici mais à l'intérieur de la transaction du repository : les contrôler
 * avant le verrou laisserait une fenêtre de compétition entre les replicas.
 */
export async function createOrder(input: CreateOrderInput): Promise<OrderDto> {
  const order = await orderRepository.createWithStockDecrement({
    customerName: input.customerName,
    items: input.items,
  });

  return toOrderDto(order);
}

export async function updateOrderStatus(
  id: string,
  status: OrderStatusInput,
): Promise<OrderDto> {
  const order = await orderRepository.findById(id);

  if (order === null) {
    throw new NotFoundError(
      'Commande introuvable',
      `Aucune commande ne correspond à l’identifiant ${id}.`,
    );
  }

  if (order.status === status) {
    return toOrderDto(order);
  }

  const allowed = ALLOWED_TRANSITIONS[order.status];

  if (!allowed.includes(status)) {
    throw new ConflictError(
      'Transition de statut interdite',
      `Une commande au statut ${order.status} ne peut pas passer à ${status}.`,
    );
  }

  return toOrderDto(await orderRepository.updateStatus(id, status));
}

/** Suppression : restitution du stock et suppression, transactionnelles. */
export async function deleteOrder(id: string): Promise<void> {
  await orderRepository.deleteWithStockRestore(id);
}
