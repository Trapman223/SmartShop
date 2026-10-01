import { BrowsingEventModel } from '../models/BrowsingEvent.model.js';
import type { BrowsingEventDocument } from '../models/BrowsingEvent.model.js';

export async function create(data: {
  userId: string;
  productId: string;
  category: string;
  eventType: string;
  metadata?: unknown;
}): Promise<BrowsingEventDocument> {
  return BrowsingEventModel.create(data);
}

export async function findByUser(
  userId: string,
  limit: number,
): Promise<BrowsingEventDocument[]> {
  return BrowsingEventModel.find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .exec();
}

/** Nombre de consultations par catégorie, pour un client. */
export async function aggregateCategoryCounts(
  userId: string,
): Promise<{ category: string; count: number }[]> {
  interface Row {
    _id: string;
    count: number;
  }

  const rows = await BrowsingEventModel.aggregate<Row>([
    { $match: { userId } },
    { $group: { _id: '$category', count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
  ]).exec();

  return rows.map((row) => ({ category: row._id, count: row.count }));
}

/** Produits consultés par un client (identifiants distincts). */
export async function findViewedProductIds(userId: string): Promise<string[]> {
  return BrowsingEventModel.distinct('productId', { userId }).exec();
}

/** Produits achetés par un client — écartés des recommandations. */
export async function findPurchasedProductIds(userId: string): Promise<string[]> {
  return BrowsingEventModel.distinct('productId', {
    userId,
    eventType: 'PURCHASE',
  }).exec();
}

/**
 * Co-consultation : produits regardés par les autres clients qui ont regardé
 * les mêmes produits que celui-ci. C'est le « les clients ayant consulté ce
 * produit ont aussi consulté… » — calculé en une seule agrégation.
 */
export async function aggregateCoViewedProducts(
  userId: string,
  viewedProductIds: readonly string[],
  limit = 50,
): Promise<{ productId: string; coViewers: number }[]> {
  if (viewedProductIds.length === 0) return [];

  interface Row {
    _id: string;
    coViewers: number;
  }

  const rows = await BrowsingEventModel.aggregate<Row>([
    // 1. Les autres clients ayant consulté au moins un produit commun.
    { $match: { productId: { $in: [...viewedProductIds] }, userId: { $ne: userId } } },
    { $group: { _id: '$userId' } },
    // 2. Tout ce que ces clients ont consulté par ailleurs.
    {
      $lookup: {
        from: 'browsing_events',
        localField: '_id',
        foreignField: 'userId',
        as: 'events',
      },
    },
    { $unwind: '$events' },
    // 3. On exclut les produits que le client a déjà vus.
    { $match: { 'events.productId': { $nin: [...viewedProductIds] } } },
    // 4. Nombre de clients distincts par produit.
    { $group: { _id: '$events.productId', users: { $addToSet: '$_id' } } },
    { $project: { coViewers: { $size: '$users' } } },
    { $sort: { coViewers: -1, _id: 1 } },
    { $limit: limit },
  ]).exec();

  return rows.map((row) => ({ productId: row._id, coViewers: row.coViewers }));
}

/** Catégorie associée à chaque produit, telle qu'observée à la navigation. */
export async function findProductCategories(): Promise<
  { productId: string; category: string }[]
> {
  interface Row {
    _id: string;
    category: string;
  }

  const rows = await BrowsingEventModel.aggregate<Row>([
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$productId', category: { $first: '$category' } } },
  ]).exec();

  return rows.map((row) => ({ productId: row._id, category: row.category }));
}
