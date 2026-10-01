import { describe, it, expect } from 'vitest';
import {
  buildOrderLines,
  mergeRequestedItems,
} from '../../src/utils/orderCalculation.js';
import type { LockedProduct } from '../../src/utils/orderCalculation.js';
import { NotFoundError, InsufficientStockError } from '../../src/errors/AppError.js';

const CASQUE: LockedProduct = {
  id: '11111111-1111-4111-8111-111111111111',
  reference: 'SS-PRD-00001',
  name: 'Casque audio sans fil',
  price: '129.90',
  stock: 5,
};

const CLAVIER: LockedProduct = {
  id: '22222222-2222-4222-8222-222222222222',
  reference: 'SS-PRD-00002',
  name: 'Clavier mécanique compact',
  price: '89.00',
  stock: 2,
};

describe('mergeRequestedItems', () => {
  it('additionne les quantités des lignes portant sur le même produit', () => {
    const merged = mergeRequestedItems([
      { productId: CASQUE.id, quantity: 3 },
      { productId: CLAVIER.id, quantity: 1 },
      { productId: CASQUE.id, quantity: 4 },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged.find((i) => i.productId === CASQUE.id)?.quantity).toBe(7);
  });

  it('laisse inchangée une liste sans doublon', () => {
    const items = [{ productId: CASQUE.id, quantity: 2 }];
    expect(mergeRequestedItems(items)).toEqual(items);
  });
});

describe('buildOrderLines — calcul du montant', () => {
  it('calcule les sous-totaux et le total sans perte décimale', () => {
    const { lines, total } = buildOrderLines([CASQUE, CLAVIER], [
      { productId: CASQUE.id, quantity: 2 },
      { productId: CLAVIER.id, quantity: 1 },
    ]);

    expect(lines).toHaveLength(2);
    expect(lines[0]?.subtotal.toFixed(2)).toBe('259.80');
    expect(lines[1]?.subtotal.toFixed(2)).toBe('89.00');
    expect(total.toFixed(2)).toBe('348.80');
  });

  it('fige le prix unitaire du produit au moment de la commande', () => {
    const { lines } = buildOrderLines([CASQUE], [
      { productId: CASQUE.id, quantity: 1 },
    ]);

    expect(lines[0]?.unitPrice.toFixed(2)).toBe('129.90');
    expect(lines[0]?.reference).toBe('SS-PRD-00001');
  });

  it('additionne exactement des montants qu’un flottant fausserait', () => {
    const centime: LockedProduct = { ...CASQUE, price: '0.10', stock: 100 };
    const { total } = buildOrderLines([centime], [
      { productId: centime.id, quantity: 3 },
    ]);

    // 0.1 × 3 vaut 0.30000000000000004 en IEEE-754.
    expect(total.toFixed(2)).toBe('0.30');
  });
});

describe('buildOrderLines — vérification des produits', () => {
  it('rejette un produit inexistant en NotFoundError', () => {
    expect(() =>
      buildOrderLines([CASQUE], [
        { productId: '33333333-3333-4333-8333-333333333333', quantity: 1 },
      ]),
    ).toThrow(NotFoundError);
  });

  it('nomme les identifiants introuvables dans le détail', () => {
    const inconnu = '33333333-3333-4333-8333-333333333333';
    try {
      buildOrderLines([CASQUE], [{ productId: inconnu, quantity: 1 }]);
      expect.unreachable('une NotFoundError était attendue');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).detail).toContain(inconnu);
    }
  });
});

describe('buildOrderLines — vérification du stock', () => {
  it('accepte une commande égale au stock disponible', () => {
    const { total } = buildOrderLines([CASQUE], [
      { productId: CASQUE.id, quantity: 5 },
    ]);

    expect(total.toFixed(2)).toBe('649.50');
  });

  it('rejette une quantité supérieure au stock', () => {
    expect(() =>
      buildOrderLines([CASQUE], [{ productId: CASQUE.id, quantity: 6 }]),
    ).toThrow(InsufficientStockError);
  });

  it('détaille la référence, le disponible et le demandé', () => {
    try {
      buildOrderLines([CLAVIER], [{ productId: CLAVIER.id, quantity: 5 }]);
      expect.unreachable('une InsufficientStockError était attendue');
    } catch (error) {
      const detail = (error as InsufficientStockError).detail ?? '';
      expect(detail).toContain('SS-PRD-00002');
      expect(detail).toContain('2 disponible(s)');
      expect(detail).toContain('5 demandé(s)');
    }
  });

  it('applique le contrôle de stock APRÈS fusion des lignes dupliquées', () => {
    // 3 + 4 = 7 > 5 : chaque ligne prise isolément passerait, pas leur somme.
    expect(() =>
      buildOrderLines([CASQUE], [
        { productId: CASQUE.id, quantity: 3 },
        { productId: CASQUE.id, quantity: 4 },
      ]),
    ).toThrow(InsufficientStockError);
  });

  it('signale tous les produits en rupture, pas seulement le premier', () => {
    try {
      buildOrderLines([CASQUE, CLAVIER], [
        { productId: CASQUE.id, quantity: 99 },
        { productId: CLAVIER.id, quantity: 99 },
      ]);
      expect.unreachable('une InsufficientStockError était attendue');
    } catch (error) {
      const detail = (error as InsufficientStockError).detail ?? '';
      expect(detail).toContain('SS-PRD-00001');
      expect(detail).toContain('SS-PRD-00002');
    }
  });

  it('rejette un produit dont le stock est nul', () => {
    const rupture: LockedProduct = { ...CASQUE, stock: 0 };
    expect(() =>
      buildOrderLines([rupture], [{ productId: rupture.id, quantity: 1 }]),
    ).toThrow(InsufficientStockError);
  });
});
