import * as reviewRepository from '../repositories/review.repository.js';
import type { ReviewSort } from '../repositories/review.repository.js';
import type { ReviewDocument } from '../models/Review.model.js';
import { ConflictError, NotFoundError } from '../errors/AppError.js';
import { buildPage } from '../utils/pagination.js';
import type { Page } from '../utils/pagination.js';
import { parseInput } from '../utils/validate.js';
import {
  createReviewSchema,
  listReviewsSchema,
  objectIdSchema,
  updateReviewSchema,
} from '../validators/review.validator.js';

interface ListArgs {
  limit?: number | null;
  offset?: number | null;
  sort?: ReviewSort | null;
  minRating?: number | null;
  tags?: string[] | null;
}

/** Retire les valeurs nulles : GraphQL envoie `null`, zod attend `undefined`. */
function normalizeArgs(args: ListArgs): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).filter(([, value]) => value !== null && value !== undefined),
  );
}

export async function getReviewById(id: string): Promise<ReviewDocument> {
  const reviewId = parseInput(objectIdSchema, id);
  const review = await reviewRepository.findById(reviewId);

  if (review === null) {
    throw new NotFoundError('Avis introuvable', `Aucun avis d’identifiant ${reviewId}.`);
  }

  return review;
}

export async function getProductReviews(
  productId: string,
  args: ListArgs,
): Promise<Page<ReviewDocument>> {
  const options = parseInput(listReviewsSchema, normalizeArgs(args));

  const { items, total } = await reviewRepository.findPage(
    {
      productId,
      ...(options.minRating !== undefined ? { minRating: options.minRating } : {}),
      ...(options.tags !== undefined ? { tags: options.tags } : {}),
    },
    options.sort,
    options.limit,
    options.offset,
  );

  return buildPage(items, total, options.limit, options.offset);
}

/** Historique des avis d'un client. */
export async function getUserReviews(
  userId: string,
  args: ListArgs,
): Promise<Page<ReviewDocument>> {
  const options = parseInput(listReviewsSchema, normalizeArgs(args));

  const { items, total } = await reviewRepository.findPage(
    {
      userId,
      ...(options.minRating !== undefined ? { minRating: options.minRating } : {}),
      ...(options.tags !== undefined ? { tags: options.tags } : {}),
    },
    options.sort,
    options.limit,
    options.offset,
  );

  return buildPage(items, total, options.limit, options.offset);
}

export async function createReview(input: unknown): Promise<ReviewDocument> {
  const data = parseInput(createReviewSchema, input);

  // Contrôle explicite avant écriture : l'index unique (userId, productId)
  // protège de toute façon, mais un message clair vaut mieux qu'une erreur
  // de clé dupliquée remontée brute.
  const existing = await reviewRepository.findByUserAndProduct(
    data.userId,
    data.productId,
  );

  if (existing !== null) {
    throw new ConflictError(
      'Avis déjà existant',
      `Le client ${data.userId} a déjà noté le produit ${data.productId}. Utilisez updateReview pour le modifier.`,
    );
  }

  return reviewRepository.create(data);
}

export async function updateReview(
  id: string,
  input: unknown,
): Promise<ReviewDocument> {
  const reviewId = parseInput(objectIdSchema, id);
  const data = parseInput(updateReviewSchema, input);

  const updated = await reviewRepository.updateById(reviewId, data);

  if (updated === null) {
    throw new NotFoundError('Avis introuvable', `Aucun avis d’identifiant ${reviewId}.`);
  }

  return updated;
}

export async function deleteReview(id: string): Promise<string> {
  const reviewId = parseInput(objectIdSchema, id);
  const deleted = await reviewRepository.deleteById(reviewId);

  if (!deleted) {
    throw new NotFoundError('Avis introuvable', `Aucun avis d’identifiant ${reviewId}.`);
  }

  return reviewId;
}
