/**
 * Moteur de recommandations.
 *
 * Volontairement simple, DÉTERMINISTE et EXPLICABLE : aucun apprentissage,
 * aucun aléa. Un même état de la base produit toujours le même classement,
 * et chaque recommandation porte la raison qui l'a fait remonter.
 *
 * Le score combine trois signaux, chacun normalisé entre 0 et 1 :
 *
 *   1. NOTE          — moyenne des avis du produit, ramenée sur [0,1].
 *   2. CATÉGORIE     — part de cette catégorie dans la navigation du client.
 *   3. SIMILARITÉ    — produits consultés par d'autres clients ayant consulté
 *                      les mêmes produits que lui (co-consultation).
 *
 * Les produits déjà notés ou déjà achetés par le client sont écartés : les
 * recommander n'aurait aucune valeur.
 *
 * Cette fonction est pure : aucun accès base, donc entièrement testable.
 */

export interface ProductStats {
  productId: string;
  /** Moyenne des notes, entre 1 et 5. */
  average: number;
  /** Nombre d'avis. */
  count: number;
  /** Catégorie observée lors des consultations ; absente si jamais consultée. */
  category: string | null;
}

export interface UserContext {
  /** Nombre de consultations par catégorie. */
  categoryCounts: ReadonlyMap<string, number>;
  /** Produits consultés par le client. */
  viewedProductIds: ReadonlySet<string>;
  /** Produits co-consultés, pondérés par le nombre de clients concernés. */
  coViewedCounts: ReadonlyMap<string, number>;
  /** Produits à exclure : déjà notés ou déjà achetés. */
  excludedProductIds: ReadonlySet<string>;
}

export interface ScoringWeights {
  rating: number;
  category: number;
  similar: number;
}

export type RecommendationReason =
  | 'HIGHLY_RATED'
  | 'CATEGORY_AFFINITY'
  | 'SIMILAR_PRODUCT'
  | 'TRENDING';

export interface ScoredRecommendation {
  productId: string;
  score: number;
  reason: RecommendationReason;
  explanation: string;
  averageRating: number | null;
  reviewCount: number;
  category: string | null;
}

/** Ramène une note de [1,5] vers [0,1]. Une note de 1 vaut donc 0. */
export function normalizeRating(average: number): number {
  const clamped = Math.min(5, Math.max(1, average));
  return (clamped - 1) / 4;
}

/**
 * Popularité normalisée par échelle logarithmique.
 * Un produit à 100 avis n'est pas 100 fois plus pertinent qu'un produit
 * à 1 avis : le log écrase cet écart tout en gardant l'ordre.
 */
export function normalizePopularity(count: number, maxCount: number): number {
  if (maxCount <= 1 || count <= 0) return 0;
  return Math.log1p(count) / Math.log1p(maxCount);
}

/** Arrondi à trois décimales, pour un score stable et lisible. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function buildExplanation(
  reason: RecommendationReason,
  stats: ProductStats,
  categoryShare: number,
  coViewers: number,
): string {
  switch (reason) {
    case 'HIGHLY_RATED':
      return `Noté ${stats.average.toFixed(1)}/5 par ${String(stats.count)} client(s).`;
    case 'CATEGORY_AFFINITY':
      return `Dans la catégorie « ${stats.category ?? 'inconnue'} », qui représente ${String(Math.round(categoryShare * 100))} % de votre navigation.`;
    case 'SIMILAR_PRODUCT':
      return `Consulté par ${String(coViewers)} client(s) ayant regardé les mêmes produits que vous.`;
    case 'TRENDING':
      return `Populaire en ce moment : ${String(stats.count)} avis déposés.`;
  }
}

export function scoreCandidates(
  candidates: readonly ProductStats[],
  context: UserContext,
  weights: ScoringWeights,
  limit: number,
): ScoredRecommendation[] {
  const totalCategoryViews = [...context.categoryCounts.values()].reduce(
    (sum, value) => sum + value,
    0,
  );
  const maxCoViews = Math.max(1, ...context.coViewedCounts.values());
  const maxReviewCount = Math.max(1, ...candidates.map((c) => c.count));

  const scored = candidates
    .filter(
      (candidate) =>
        !context.excludedProductIds.has(candidate.productId) &&
        !context.viewedProductIds.has(candidate.productId),
    )
    .map<ScoredRecommendation>((candidate) => {
      // La note est pondérée par la fiabilité : 4,8/5 sur un seul avis
      // vaut moins que 4,5/5 sur cinquante. La confiance va de 0,5 (un
      // seul avis) à 1 (produit le plus commenté du lot).
      const confidence =
        0.5 + 0.5 * normalizePopularity(candidate.count, maxReviewCount);
      const ratingScore = normalizeRating(candidate.average) * confidence;

      const categoryViews =
        candidate.category !== null
          ? (context.categoryCounts.get(candidate.category) ?? 0)
          : 0;
      const categoryShare =
        totalCategoryViews > 0 ? categoryViews / totalCategoryViews : 0;

      const coViewers = context.coViewedCounts.get(candidate.productId) ?? 0;
      const similarScore = coViewers / maxCoViews;

      const contributions = {
        rating: weights.rating * ratingScore,
        category: weights.category * categoryShare,
        similar: weights.similar * similarScore,
      };

      const score =
        contributions.rating + contributions.category + contributions.similar;

      // La raison affichée est le signal qui a le plus contribué au score.
      // Si aucun signal personnel ne ressort, le produit est simplement
      // « tendance » : c'est le cas d'un client sans historique.
      let reason: RecommendationReason = 'HIGHLY_RATED';
      if (
        contributions.category >= contributions.rating &&
        contributions.category >= contributions.similar &&
        contributions.category > 0
      ) {
        reason = 'CATEGORY_AFFINITY';
      } else if (
        contributions.similar >= contributions.rating &&
        contributions.similar > 0
      ) {
        reason = 'SIMILAR_PRODUCT';
      } else if (contributions.rating === 0) {
        reason = 'TRENDING';
      }

      return {
        productId: candidate.productId,
        score: round(score),
        reason,
        explanation: buildExplanation(reason, candidate, categoryShare, coViewers),
        averageRating: candidate.count > 0 ? round(candidate.average) : null,
        reviewCount: candidate.count,
        category: candidate.category,
      };
    });

  // Tri déterministe : à score égal, le produit le mieux noté passe devant,
  // puis l'identifiant départage. Sans ce dernier critère, deux exécutions
  // sur les mêmes données pourraient renvoyer des ordres différents.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ratingA = a.averageRating ?? 0;
    const ratingB = b.averageRating ?? 0;
    if (ratingB !== ratingA) return ratingB - ratingA;
    return a.productId.localeCompare(b.productId);
  });

  return scored.slice(0, limit);
}
