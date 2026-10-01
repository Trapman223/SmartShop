import { Prisma } from '@prisma/client';

/**
 * Les montants monétaires ne transitent jamais en nombre flottant
 * (cf. CLAUDE.md section 5, règle 8).
 *
 * En base : NUMERIC(10,2) / NUMERIC(12,2).
 * En mémoire : Prisma.Decimal (arithmétique décimale exacte).
 * En JSON : chaîne à deux décimales, ex. "129.90" — un nombre JavaScript
 * ne peut pas représenter exactement 0,1 + 0,2, ce qui fausserait les totaux.
 */
export type MoneyString = string;

export type DecimalLike = Prisma.Decimal | string | number;

export function toDecimal(value: DecimalLike): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

/** Sérialisation JSON d'un montant : toujours deux décimales. */
export function toMoneyString(value: DecimalLike): MoneyString {
  return toDecimal(value).toFixed(2);
}

/** Sous-total d'une ligne de commande : prix unitaire × quantité. */
export function lineSubtotal(unitPrice: DecimalLike, quantity: number): Prisma.Decimal {
  return toDecimal(unitPrice).mul(quantity);
}

/** Somme d'une liste de montants. Renvoie 0 pour une liste vide. */
export function sumDecimals(values: readonly DecimalLike[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>(
    (accumulator, value) => accumulator.add(toDecimal(value)),
    new Prisma.Decimal(0),
  );
}
