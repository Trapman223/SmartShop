import { z } from 'zod';
import { moneySchema, paginationQuerySchema } from './common.validator.js';

/** Référence catalogue : majuscules, chiffres et tirets, ex. SS-PRD-00123. */
export const referenceSchema = z
  .string()
  .trim()
  .min(3, 'référence trop courte (3 caractères minimum)')
  .max(32, 'référence trop longue (32 caractères maximum)')
  .regex(
    /^[A-Z0-9][A-Z0-9-]*$/,
    'référence invalide : majuscules, chiffres et tirets uniquement (ex. SS-PRD-00123)',
  );

const nameSchema = z
  .string()
  .trim()
  .min(1, 'le nom est obligatoire')
  .max(200, 'nom trop long (200 caractères maximum)');

const descriptionSchema = z
  .string()
  .trim()
  .max(2000, 'description trop longue (2000 caractères maximum)');

const stockSchema = z
  .number()
  .int('le stock doit être un entier')
  .min(0, 'le stock ne peut pas être négatif')
  .max(1_000_000, 'stock hors limites');

/** POST /products — tous les champs métier sont requis. */
export const createProductSchema = z.object({
  reference: referenceSchema,
  name: nameSchema,
  description: descriptionSchema.optional(),
  price: moneySchema,
  stock: stockSchema,
});

/**
 * PUT /products/:id — remplacement complet de la ressource.
 * Sémantique PUT : les champs métier sont requis, un champ absent est
 * effacé (`description` repasse à null) plutôt que conservé.
 */
export const replaceProductSchema = z.object({
  reference: referenceSchema,
  name: nameSchema,
  description: descriptionSchema.nullable().optional(),
  price: moneySchema,
  stock: stockSchema,
});

export const listProductsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(200).optional(),
  minPrice: moneySchema.optional(),
  maxPrice: moneySchema.optional(),
  inStock: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  sort: z
    .enum(['price:asc', 'price:desc', 'name:asc', 'name:desc', 'createdAt:desc', 'createdAt:asc'])
    .default('createdAt:desc'),
});

/** GET /products/batch?refs=SS-PRD-1,SS-PRD-2 — consommé par avis-api (flux 1). */
export const batchProductsQuerySchema = z.object({
  refs: z
    .string()
    .trim()
    .min(1, 'le paramètre refs est obligatoire')
    .transform((value) => value.split(',').map((ref) => ref.trim()).filter(Boolean))
    .pipe(
      z
        .array(referenceSchema)
        .min(1, 'au moins une référence est attendue')
        .max(100, '100 références maximum par appel'),
    ),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type ReplaceProductInput = z.infer<typeof replaceProductSchema>;
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
