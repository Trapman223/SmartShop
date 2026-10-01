import { z } from 'zod';
import { DEFAULT_LIMIT, DEFAULT_PAGE, MAX_LIMIT } from '../utils/pagination.js';

/** Identifiant de ressource : UUID v4 généré par Prisma. */
export const uuidSchema = z.string().uuid('identifiant invalide (UUID attendu)');

export const idParamSchema = z.object({
  id: uuidSchema,
});

/** Montant monétaire : chaîne ou nombre, positif, deux décimales maximum. */
export const moneySchema = z
  .union([z.number(), z.string()])
  .superRefine((value, ctx) => {
    const text = String(value).trim();

    if (!/^\d+(\.\d{1,2})?$/.test(text)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'montant invalide : un nombre positif à deux décimales maximum est attendu (ex. 129.90)',
      });
      return;
    }
    if (Number(text) > 99_999_999) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'montant hors limites',
      });
    }
  })
  .transform((value) => String(value).trim());

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(DEFAULT_PAGE),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
