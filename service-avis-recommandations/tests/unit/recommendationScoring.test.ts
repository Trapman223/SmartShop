import { describe, it, expect } from 'vitest';
import {
  normalizePopularity,
  normalizeRating,
  scoreCandidates,
} from '../../src/utils/recommendationScoring.js';
import type {
  ProductStats,
  UserContext,
} from '../../src/utils/recommendationScoring.js';

const WEIGHTS = { rating: 0.5, category: 0.3, similar: 0.2 };

function context(overrides: Partial<UserContext> = {}): UserContext {
  return {
    categoryCounts: new Map(),
    viewedProductIds: new Set(),
    coViewedCounts: new Map(),
    excludedProductIds: new Set(),
    ...overrides,
  };
}

const AUDIO: ProductStats = {
  productId: 'p-audio',
  average: 4.8,
  count: 40,
  category: 'audio',
};
const CLAVIER: ProductStats = {
  productId: 'p-clavier',
  average: 3.2,
  count: 40,
  category: 'peripherique',
};

describe('normalizeRating', () => {
  it('ramène [1,5] vers [0,1]', () => {
    expect(normalizeRating(1)).toBe(0);
    expect(normalizeRating(3)).toBe(0.5);
    expect(normalizeRating(5)).toBe(1);
  });

  it('borne les valeurs hors plage', () => {
    expect(normalizeRating(0)).toBe(0);
    expect(normalizeRating(9)).toBe(1);
  });
});

describe('normalizePopularity', () => {
  it('vaut 0 sans avis', () => {
    expect(normalizePopularity(0, 100)).toBe(0);
  });

  it('atteint 1 pour le produit le plus commenté', () => {
    expect(normalizePopularity(100, 100)).toBe(1);
  });

  it('écrase les écarts : 100 avis ne valent pas 100 fois 1 avis', () => {
    const un = normalizePopularity(1, 100);
    const cent = normalizePopularity(100, 100);

    expect(cent / un).toBeLessThan(10);
  });
});

describe('scoreCandidates — déterminisme', () => {
  it('produit exactement le même classement à chaque exécution', () => {
    const candidats = [AUDIO, CLAVIER, { ...AUDIO, productId: 'p-ecran', average: 4.8 }];

    const a = scoreCandidates(candidats, context(), WEIGHTS, 10);
    const b = scoreCandidates(candidats, context(), WEIGHTS, 10);

    expect(a.map((r) => r.productId)).toEqual(b.map((r) => r.productId));
  });

  it('départage par identifiant à score et note identiques', () => {
    const jumeaux: ProductStats[] = [
      { productId: 'p-zebre', average: 4, count: 10, category: null },
      { productId: 'p-alpha', average: 4, count: 10, category: null },
    ];

    const resultat = scoreCandidates(jumeaux, context(), WEIGHTS, 10);

    expect(resultat.map((r) => r.productId)).toEqual(['p-alpha', 'p-zebre']);
  });
});

describe('scoreCandidates — exclusions', () => {
  it('écarte les produits déjà notés ou achetés', () => {
    const resultat = scoreCandidates(
      [AUDIO, CLAVIER],
      context({ excludedProductIds: new Set(['p-audio']) }),
      WEIGHTS,
      10,
    );

    expect(resultat.map((r) => r.productId)).toEqual(['p-clavier']);
  });

  it('écarte les produits déjà consultés', () => {
    const resultat = scoreCandidates(
      [AUDIO, CLAVIER],
      context({ viewedProductIds: new Set(['p-clavier']) }),
      WEIGHTS,
      10,
    );

    expect(resultat.map((r) => r.productId)).toEqual(['p-audio']);
  });

  it('respecte la limite demandée', () => {
    const beaucoup = Array.from({ length: 30 }, (_, i) => ({
      ...AUDIO,
      productId: `p-${String(i).padStart(2, '0')}`,
    }));

    expect(scoreCandidates(beaucoup, context(), WEIGHTS, 5)).toHaveLength(5);
  });
});

describe('scoreCandidates — signaux et explications', () => {
  it('sans historique, classe par note : le mieux noté remonte', () => {
    const resultat = scoreCandidates([CLAVIER, AUDIO], context(), WEIGHTS, 10);

    expect(resultat[0]?.productId).toBe('p-audio');
    expect(resultat[0]?.reason).toBe('HIGHLY_RATED');
    expect(resultat[0]?.explanation).toContain('4.8/5');
  });

  it('une forte affinité de catégorie fait remonter un produit moins bien noté', () => {
    const resultat = scoreCandidates(
      [AUDIO, CLAVIER],
      context({ categoryCounts: new Map([['peripherique', 50]]) }),
      WEIGHTS,
      10,
    );

    expect(resultat[0]?.productId).toBe('p-clavier');
    expect(resultat[0]?.reason).toBe('CATEGORY_AFFINITY');
    expect(resultat[0]?.explanation).toContain('peripherique');
    expect(resultat[0]?.explanation).toContain('100 %');
  });

  it('la co-consultation est attribuée à SIMILAR_PRODUCT', () => {
    const faible: ProductStats = {
      productId: 'p-co',
      average: 1,
      count: 1,
      category: null,
    };

    const resultat = scoreCandidates(
      [faible],
      context({ coViewedCounts: new Map([['p-co', 12]]) }),
      WEIGHTS,
      10,
    );

    expect(resultat[0]?.reason).toBe('SIMILAR_PRODUCT');
    expect(resultat[0]?.explanation).toContain('12 client(s)');
  });

  it('un produit sans avis est marqué TRENDING, pas HIGHLY_RATED', () => {
    const sansAvis: ProductStats = {
      productId: 'p-neuf',
      average: 0,
      count: 0,
      category: null,
    };

    const resultat = scoreCandidates([sansAvis], context(), WEIGHTS, 10);

    expect(resultat[0]?.reason).toBe('TRENDING');
    expect(resultat[0]?.averageRating).toBeNull();
  });

  it('pondère la note par la fiabilité : 5/5 sur 1 avis perd face à 4.5/5 sur 100', () => {
    const fragile: ProductStats = {
      productId: 'p-fragile',
      average: 5,
      count: 1,
      category: null,
    };
    const solide: ProductStats = {
      productId: 'p-solide',
      average: 4.5,
      count: 100,
      category: null,
    };

    const resultat = scoreCandidates([fragile, solide], context(), WEIGHTS, 10);

    expect(resultat[0]?.productId).toBe('p-solide');
  });

  it('borne le score entre 0 et 1 et l’arrondit au millième', () => {
    const resultat = scoreCandidates(
      [AUDIO],
      context({
        categoryCounts: new Map([['audio', 10]]),
        coViewedCounts: new Map([['p-audio', 5]]),
      }),
      WEIGHTS,
      10,
    );

    const score = resultat[0]?.score ?? -1;
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
    expect(String(score).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(3);
  });

  it('renvoie une liste vide si tous les candidats sont exclus', () => {
    const resultat = scoreCandidates(
      [AUDIO],
      context({ excludedProductIds: new Set(['p-audio']) }),
      WEIGHTS,
      10,
    );

    expect(resultat).toEqual([]);
  });
});
