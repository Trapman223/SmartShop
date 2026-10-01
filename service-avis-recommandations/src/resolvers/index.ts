import { DateTimeScalar } from '../graphql/scalars.js';
import { JSONScalar } from '../graphql/jsonScalar.js';
import { env, SERVICE_NAME } from '../config/env.js';
import { isDatabaseReachable } from '../db/mongoose.js';
import * as reviewService from '../services/review.service.js';
import * as ratingService from '../services/rating.service.js';
import * as browsingService from '../services/browsing.service.js';
import * as recommendationService from '../services/recommendation.service.js';
import { toBrowsingEvent, toProductRating, toReview } from './serializers.js';
import type { ReviewSort } from '../repositories/review.repository.js';
import type { GraphQLContext } from '../context.js';
import type { CatalogueProduct } from '../clients/catalogue.client.js';

interface ListArgs {
  limit?: number | null;
  offset?: number | null;
  sort?: ReviewSort | null;
  minRating?: number | null;
  tags?: string[] | null;
}

/**
 * Flux 1 — résolution d'un champ `product` (cf. CLAUDE.md section 2).
 *
 * Les trois types qui exposent `product` portent tous un `productId` : le
 * même resolver les sert donc tous les trois. L'appel passe par le
 * DataLoader du contexte, qui regroupe toutes les références d'une même
 * requête en un seul `GET /products/batch` — aucun N+1.
 *
 * Renvoie `null` si la référence est inconnue du catalogue ou si
 * `catalogue-api` est indisponible : la requête GraphQL reste servie.
 */
function resolveProduct(
  parent: { productId: string },
  _args: unknown,
  context: GraphQLContext,
): Promise<CatalogueProduct | null> {
  return context.loaders.product.load(parent.productId);
}

export const resolvers = {
  DateTime: DateTimeScalar,
  JSON: JSONScalar,

  Query: {
    health: () => ({
      status: 'ok',
      service: SERVICE_NAME,
      environment: env.NODE_ENV,
      database: isDatabaseReachable() ? 'up' : 'down',
      timestamp: new Date().toISOString(),
    }),

    review: async (_parent: unknown, args: { id: string }) =>
      toReview(await reviewService.getReviewById(args.id)),

    productsReviews: async (
      _parent: unknown,
      args: { productId: string } & ListArgs,
    ) => {
      const { productId, ...options } = args;
      const page = await reviewService.getProductReviews(productId, options);
      return { ...page, items: page.items.map(toReview) };
    },

    userReviews: async (_parent: unknown, args: { userId: string } & ListArgs) => {
      const { userId, ...options } = args;
      const page = await reviewService.getUserReviews(userId, options);
      return { ...page, items: page.items.map(toReview) };
    },

    recommendations: async (
      _parent: unknown,
      args: { userId: string; limit?: number | null },
    ) => recommendationService.getRecommendations(args.userId, args.limit),

    productRating: async (_parent: unknown, args: { productId: string }) =>
      toProductRating(await ratingService.getProductRating(args.productId)),

    productRatings: async (_parent: unknown, args: { productIds: string[] }) => {
      const ratings = await ratingService.getProductRatings(args.productIds);
      return ratings.map(toProductRating);
    },

    browsingHistory: async (
      _parent: unknown,
      args: { userId: string; limit?: number | null },
    ) => {
      const events = await browsingService.getBrowsingHistory(
        args.userId,
        args.limit ?? 50,
      );
      return events.map(toBrowsingEvent);
    },
  },

  Mutation: {
    createReview: async (_parent: unknown, args: { input: unknown }) =>
      toReview(await reviewService.createReview(args.input)),

    updateReview: async (
      _parent: unknown,
      args: { id: string; input: unknown },
    ) => toReview(await reviewService.updateReview(args.id, args.input)),

    deleteReview: async (_parent: unknown, args: { id: string }) => ({
      id: await reviewService.deleteReview(args.id),
      deleted: true,
    }),

    trackBrowsingEvent: async (_parent: unknown, args: { input: unknown }) =>
      toBrowsingEvent(await browsingService.trackEvent(args.input)),
  },

  // --- Flux 1 : résolution des champs `Product` auprès de catalogue-api ---
  Review: { product: resolveProduct },
  ProductRating: { product: resolveProduct },
  Recommendation: { product: resolveProduct },
};
