import type { Prisma } from '@prisma/client';
import { NotFoundError, InsufficientStockError } from '../errors/AppError.js';
import { lineSubtotal, sumDecimals, toDecimal } from './money.js';

/**
 * Règles métier de création d'une commande, isolées en fonction pure.
 *
 * Pourquoi ici et pas dans le repository : ces règles doivent s'exécuter
 * À L'INTÉRIEUR de la transaction, une fois les lignes produits verrouillées.
 * Les extraire permet de les tester unitairement sans PostgreSQL, tout en
 * laissant le repository ne gérer que le verrou et les écritures.
 */

/** Produit tel que retourné par le SELECT ... FOR UPDATE. */
export interface LockedProduct {
  id: string;
  reference: string;
  name: string;
  price: Prisma.Decimal | string;
  stock: number;
}

export interface RequestedItem {
  productId: string;
  quantity: number;
}

export interface ComputedLine {
  productId: string;
  reference: string;
  quantity: number;
  unitPrice: Prisma.Decimal;
  subtotal: Prisma.Decimal;
}

export interface ComputedOrder {
  lines: ComputedLine[];
  total: Prisma.Decimal;
}

/**
 * Fusionne les lignes portant sur le même produit.
 * Sans cela, `[{p, 3}, {p, 4}]` violerait la contrainte UNIQUE
 * (order_id, product_id) et ne vérifierait le stock que ligne par ligne.
 */
export function mergeRequestedItems(
  items: readonly RequestedItem[],
): RequestedItem[] {
  const merged = new Map<string, number>();

  for (const item of items) {
    merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.quantity);
  }

  return [...merged.entries()].map(([productId, quantity]) => ({
    productId,
    quantity,
  }));
}

/**
 * Étapes 1 à 3 de la création de commande :
 *   1. vérifier que tous les produits demandés existent  → 404
 *   2. vérifier le stock disponible pour chacun          → 409
 *   3. calculer les sous-totaux et le montant total
 *
 * @throws NotFoundError         si un produit demandé n'existe pas
 * @throws InsufficientStockError si le stock d'un produit est insuffisant
 */
export function buildOrderLines(
  lockedProducts: readonly LockedProduct[],
  requestedItems: readonly RequestedItem[],
): ComputedOrder {
  const byId = new Map(lockedProducts.map((product) => [product.id, product]));
  const items = mergeRequestedItems(requestedItems);

  // 1. Tous les produits existent-ils ?
  const missing = items
    .filter((item) => !byId.has(item.productId))
    .map((item) => item.productId);

  if (missing.length > 0) {
    throw new NotFoundError(
      'Produit introuvable',
      `Aucun produit ne correspond aux identifiants suivants : ${missing.join(', ')}.`,
    );
  }

  // 2. Le stock est-il suffisant ?
  const shortages = items.flatMap((item) => {
    const product = byId.get(item.productId);
    if (product === undefined || product.stock >= item.quantity) return [];
    return [
      `${product.reference} : ${String(product.stock)} disponible(s), ${String(item.quantity)} demandé(s)`,
    ];
  });

  if (shortages.length > 0) {
    throw new InsufficientStockError(
      'Stock insuffisant',
      shortages.join(' ; '),
    );
  }

  // 3. Calcul des montants.
  const lines = items.map<ComputedLine>((item) => {
    // Le `??` est inatteignable : l'absence a été rejetée en étape 1.
    const product = byId.get(item.productId);
    if (product === undefined) {
      throw new NotFoundError('Produit introuvable', item.productId);
    }

    const unitPrice = toDecimal(product.price);

    return {
      productId: product.id,
      reference: product.reference,
      quantity: item.quantity,
      unitPrice,
      subtotal: lineSubtotal(unitPrice, item.quantity),
    };
  });

  return {
    lines,
    total: sumDecimals(lines.map((line) => line.subtotal)),
  };
}
