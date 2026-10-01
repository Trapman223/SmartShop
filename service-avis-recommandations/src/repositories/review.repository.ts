import type { PipelineStage } from 'mongoose';
import { ReviewModel } from '../models/Review.model.js';
import type { ReviewDocument } from '../models/Review.model.js';

export type ReviewSort =
  | 'NEWEST'
  | 'OLDEST'
  | 'HIGHEST_RATING'
  | 'LOWEST_RATING';

const SORT_CLAUSES: Record<ReviewSort, Record<string, 1 | -1>> = {
  NEWEST: { createdAt: -1 },
  OLDEST: { createdAt: 1 },
  HIGHEST_RATING: { rating: -1, createdAt: -1 },
  LOWEST_RATING: { rating: 1, createdAt: -1 },
};

export interface ListFilters {
  productId?: string;
  userId?: string;
  minRating?: number;
  tags?: string[];
}

function buildQuery(filters: ListFilters): Record<string, unknown> {
  const query: Record<string, unknown> = {};

  if (filters.productId !== undefined) query['productId'] = filters.productId;
  if (filters.userId !== undefined) query['userId'] = filters.userId;
  if (filters.minRating !== undefined) query['rating'] = { $gte: filters.minRating };
  // $all : l'avis doit porter TOUS les tags demandés, pas seulement l'un d'eux.
  if (filters.tags !== undefined && filters.tags.length > 0) {
    query['tags'] = { $all: filters.tags };
  }

  return query;
}

export async function findPage(
  filters: ListFilters,
  sort: ReviewSort,
  limit: number,
  offset: number,
): Promise<{ items: ReviewDocument[]; total: number }> {
  const query = buildQuery(filters);

  const [items, total] = await Promise.all([
    ReviewModel.find(query).sort(SORT_CLAUSES[sort]).skip(offset).limit(limit).exec(),
    ReviewModel.countDocuments(query).exec(),
  ]);

  return { items, total };
}

export async function findById(id: string): Promise<ReviewDocument | null> {
  return ReviewModel.findById(id).exec();
}

export async function findByUserAndProduct(
  userId: string,
  productId: string,
): Promise<ReviewDocument | null> {
  return ReviewModel.findOne({ userId, productId }).exec();
}

export async function create(data: {
  userId: string;
  productId: string;
  rating: number;
  comment: string;
  tags: string[];
}): Promise<ReviewDocument> {
  return ReviewModel.create(data);
}

export async function updateById(
  id: string,
  data: {
    rating?: number | undefined;
    comment?: string | undefined;
    tags?: string[] | undefined;
  },
): Promise<ReviewDocument | null> {
  return ReviewModel.findByIdAndUpdate(id, data, {
    new: true,
    runValidators: true,
  }).exec();
}

export async function deleteById(id: string): Promise<boolean> {
  const result = await ReviewModel.findByIdAndDelete(id).exec();
  return result !== null;
}

/** Identifiants des produits déjà notés par un client. */
export async function findReviewedProductIds(userId: string): Promise<string[]> {
  return ReviewModel.distinct('productId', { userId }).exec();
}

export interface RatingAggregate {
  productId: string;
  average: number;
  count: number;
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
}

/**
 * Notes moyennes par produit, calculées par agrégation MongoDB.
 *
 * Tout est fait côté base : sans `productIds`, l'agrégation porte sur toute
 * la collection et sert de base au catalogue de candidats des recommandations.
 */
export async function aggregateRatings(
  productIds?: readonly string[],
): Promise<RatingAggregate[]> {
  const countIf = (value: number) => ({
    $sum: { $cond: [{ $eq: ['$rating', value] }, 1, 0] },
  });

  const pipeline: PipelineStage[] = [];

  if (productIds !== undefined) {
    pipeline.push({ $match: { productId: { $in: [...productIds] } } });
  }

  pipeline.push({
    $group: {
      _id: '$productId',
      average: { $avg: '$rating' },
      count: { $sum: 1 },
      r1: countIf(1),
      r2: countIf(2),
      r3: countIf(3),
      r4: countIf(4),
      r5: countIf(5),
    },
  });

  interface GroupRow {
    _id: string;
    average: number;
    count: number;
    r1: number;
    r2: number;
    r3: number;
    r4: number;
    r5: number;
  }

  const rows = await ReviewModel.aggregate<GroupRow>(pipeline).exec();

  return rows.map((row) => ({
    productId: row._id,
    average: row.average,
    count: row.count,
    distribution: {
      '1': row.r1,
      '2': row.r2,
      '3': row.r3,
      '4': row.r4,
      '5': row.r5,
    },
  }));
}

/** Tags les plus fréquents pour un produit. */
export async function aggregateTopTags(
  productId: string,
  limit = 5,
): Promise<{ tag: string; count: number }[]> {
  interface TagRow {
    _id: string;
    count: number;
  }

  const rows = await ReviewModel.aggregate<TagRow>([
    { $match: { productId } },
    { $unwind: '$tags' },
    { $group: { _id: '$tags', count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: limit },
  ]).exec();

  return rows.map((row) => ({ tag: row._id, count: row.count }));
}
