import * as reviewRepository from '../repositories/review.repository.js';
import * as browsingRepository from '../repositories/browsingEvent.repository.js';
import { scoreCandidates } from '../utils/recommendationScoring.js';
import type {
  ProductStats,
  ScoredRecommendation,
} from '../utils/recommendationScoring.js';
import { env } from '../config/env.js';
import { parseInput } from '../utils/validate.js';
import { recommendationsSchema } from '../validators/review.validator.js';

/**
 * Recommandations personnalisées.
 *
 * Ce service ne fait qu'assembler les données : toute la logique de score
 * vit dans `utils/recommendationScoring.ts`, sous forme de fonction pure —
 * ce qui la rend testable sans MongoDB et vérifiable à la lecture.
 *
 * Cas du client inconnu : sans historique, les signaux personnels valent 0
 * et le classement se réduit aux produits les mieux notés. Le service
 * répond donc toujours quelque chose d'utile, jamais une liste vide.
 */
export async function getRecommendations(
  userIdInput: string,
  limitInput?: number | null,
): Promise<ScoredRecommendation[]> {
  const { userId, limit } = parseInput(recommendationsSchema, {
    userId: userIdInput,
    ...(limitInput !== null && limitInput !== undefined ? { limit: limitInput } : {}),
  });

  const [
    ratings,
    categoryCounts,
    viewedProductIds,
    purchasedProductIds,
    reviewedProductIds,
    productCategories,
  ] = await Promise.all([
    reviewRepository.aggregateRatings(),
    browsingRepository.aggregateCategoryCounts(userId),
    browsingRepository.findViewedProductIds(userId),
    browsingRepository.findPurchasedProductIds(userId),
    reviewRepository.findReviewedProductIds(userId),
    browsingRepository.findProductCategories(),
  ]);

  const coViewed = await browsingRepository.aggregateCoViewedProducts(
    userId,
    viewedProductIds,
  );

  const categoryByProduct = new Map(
    productCategories.map((entry) => [entry.productId, entry.category]),
  );

  // Les candidats sont les produits notés, plus ceux simplement consultés
  // par d'autres clients (co-consultation) même s'ils n'ont aucun avis.
  const candidateIds = new Set<string>([
    ...ratings.map((rating) => rating.productId),
    ...coViewed.map((entry) => entry.productId),
  ]);

  const ratingByProduct = new Map(ratings.map((rating) => [rating.productId, rating]));

  const candidates: ProductStats[] = [...candidateIds]
    .map((productId) => {
      const rating = ratingByProduct.get(productId);
      return {
        productId,
        average: rating?.average ?? 0,
        count: rating?.count ?? 0,
        category: categoryByProduct.get(productId) ?? null,
      };
    })
    .filter((candidate) => candidate.count >= env.RECO_MIN_REVIEWS || candidate.count === 0);

  return scoreCandidates(
    candidates,
    {
      categoryCounts: new Map(
        categoryCounts.map((entry) => [entry.category, entry.count]),
      ),
      viewedProductIds: new Set(viewedProductIds),
      coViewedCounts: new Map(
        coViewed.map((entry) => [entry.productId, entry.coViewers]),
      ),
      excludedProductIds: new Set([...reviewedProductIds, ...purchasedProductIds]),
    },
    {
      rating: env.RECO_WEIGHT_RATING,
      category: env.RECO_WEIGHT_CATEGORY,
      similar: env.RECO_WEIGHT_SIMILAR,
    },
    limit,
  );
}
