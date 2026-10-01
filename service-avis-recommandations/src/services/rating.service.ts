import * as reviewRepository from '../repositories/review.repository.js';

export interface ProductRating {
  productId: string;
  average: number;
  count: number;
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
  topTags: { tag: string; count: number }[];
}

/** Note d'un produit. Renvoie un agrégat vide si le produit n'a aucun avis. */
export async function getProductRating(productId: string): Promise<ProductRating> {
  const [aggregates, topTags] = await Promise.all([
    reviewRepository.aggregateRatings([productId]),
    reviewRepository.aggregateTopTags(productId),
  ]);

  const aggregate = aggregates[0];

  if (aggregate === undefined) {
    return {
      productId,
      average: 0,
      count: 0,
      distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
      topTags: [],
    };
  }

  return { ...aggregate, topTags };
}

export async function getProductRatings(
  productIds: readonly string[],
): Promise<ProductRating[]> {
  const aggregates = await reviewRepository.aggregateRatings(productIds);
  const byId = new Map(aggregates.map((a) => [a.productId, a]));

  return productIds.map((productId) => {
    const aggregate = byId.get(productId);

    return aggregate === undefined
      ? {
          productId,
          average: 0,
          count: 0,
          distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
          topTags: [],
        }
      : { ...aggregate, topTags: [] };
  });
}
