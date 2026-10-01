import { describe, it, expect } from 'vitest';
import {
  lineSubtotal,
  sumDecimals,
  toDecimal,
  toMoneyString,
} from '../../src/utils/money.js';

describe('money — sérialisation des montants', () => {
  it('formate systématiquement à deux décimales', () => {
    expect(toMoneyString('7')).toBe('7.00');
    expect(toMoneyString('7.5')).toBe('7.50');
    expect(toMoneyString('129.90')).toBe('129.90');
  });

  it('accepte une chaîne, un nombre ou un Decimal', () => {
    expect(toMoneyString(12.5)).toBe('12.50');
    expect(toMoneyString(toDecimal('12.5'))).toBe('12.50');
  });
});

describe('money — arithmétique décimale', () => {
  it('multiplie sans erreur d’arrondi', () => {
    expect(lineSubtotal('19.99', 3).toFixed(2)).toBe('59.97');
  });

  it('additionne 0.10 + 0.20 exactement', () => {
    // En IEEE-754, 0.1 + 0.2 === 0.30000000000000004.
    expect(sumDecimals(['0.10', '0.20']).toFixed(2)).toBe('0.30');
  });

  it('renvoie 0 pour une liste vide', () => {
    expect(sumDecimals([]).toFixed(2)).toBe('0.00');
  });

  it('cumule un grand nombre de lignes sans dérive', () => {
    const cents = Array.from({ length: 100 }, () => '0.01');
    expect(sumDecimals(cents).toFixed(2)).toBe('1.00');
  });
});
