import type { ReviewDocument } from '../models/Review.model.js';
import type { BrowsingEventDocument } from '../models/BrowsingEvent.model.js';
import type { ProductRating } from '../services/rating.service.js';

export interface ReviewGraphQL {
  id: string;
  userId: string;
  productId: string;
  rating: number;
  comment: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

/** Projette un document Mongoose vers le type GraphQL (`_id` → `id`). */
export function toReview(document: ReviewDocument): ReviewGraphQL {
  return {
    id: document.id as string,
    userId: document.userId,
    productId: document.productId,
    rating: document.rating,
    comment: document.comment,
    tags: [...document.tags],
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export interface BrowsingEventGraphQL {
  id: string;
  userId: string;
  productId: string;
  category: string;
  eventType: string;
  metadata: unknown;
  createdAt: Date;
}

export function toBrowsingEvent(
  document: BrowsingEventDocument,
): BrowsingEventGraphQL {
  return {
    id: document.id as string,
    userId: document.userId,
    productId: document.productId,
    category: document.category,
    eventType: document.eventType,
    metadata: document.metadata ?? null,
    createdAt: document.createdAt,
  };
}

/**
 * La distribution est nommée `one`..`five` en GraphQL : un nom de champ ne
 * peut pas commencer par un chiffre.
 */
export function toProductRating(rating: ProductRating): {
  productId: string;
  average: number;
  count: number;
  distribution: {
    one: number;
    two: number;
    three: number;
    four: number;
    five: number;
  };
  topTags: { tag: string; count: number }[];
} {
  return {
    productId: rating.productId,
    average: Math.round(rating.average * 100) / 100,
    count: rating.count,
    distribution: {
      one: rating.distribution['1'],
      two: rating.distribution['2'],
      three: rating.distribution['3'],
      four: rating.distribution['4'],
      five: rating.distribution['5'],
    },
    topTags: rating.topTags,
  };
}
