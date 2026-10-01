import { z } from 'zod';
import { MAX_LIMIT } from '../utils/pagination.js';
import { env } from '../config/env.js';
import { BROWSING_EVENT_TYPES } from '../models/BrowsingEvent.model.js';

/** Identifiant MongoDB : 24 caractères hexadécimaux. */
export const objectIdSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'identifiant invalide (ObjectId attendu)');

const identifierSchema = z
  .string()
  .trim()
  .min(1, 'identifiant obligatoire')
  .max(64, 'identifiant trop long (64 caractères maximum)');

/** Note : entier strictement compris entre 1 et 5. */
export const ratingSchema = z
  .number()
  .int('la note doit être un entier')
  .min(1, 'la note doit être comprise entre 1 et 5')
  .max(5, 'la note doit être comprise entre 1 et 5');

const commentSchema = z
  .string()
  .trim()
  .min(1, 'le commentaire est obligatoire')
  .max(2000, 'commentaire trop long (2000 caractères maximum)');

const tagsSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1, 'un tag ne peut pas être vide')
      .max(40, 'tag trop long (40 caractères maximum)')
      .regex(/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u, 'tag invalide'),
  )
  .max(10, '10 tags maximum par avis')
  // Normalisation : minuscules et dédoublonnage, pour que « Qualité » et
  // « qualité » ne comptent pas comme deux tags distincts dans les agrégats.
  .transform((tags) => [...new Set(tags.map((tag) => tag.toLowerCase()))]);

export const createReviewSchema = z.object({
  userId: identifierSchema,
  productId: identifierSchema,
  rating: ratingSchema,
  comment: commentSchema,
  tags: tagsSchema.optional().default([]),
});

export const updateReviewSchema = z
  .object({
    rating: ratingSchema.optional(),
    comment: commentSchema.optional(),
    tags: tagsSchema.optional(),
  })
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    { message: 'au moins un champ doit être fourni pour la mise à jour' },
  );

export const reviewSortSchema = z
  .enum(['NEWEST', 'OLDEST', 'HIGHEST_RATING', 'LOWEST_RATING'])
  .default('NEWEST');

export const paginationSchema = z.object({
  limit: z.number().int().min(1).max(MAX_LIMIT).default(20),
  offset: z.number().int().min(0).default(0),
});

export const listReviewsSchema = paginationSchema.extend({
  sort: reviewSortSchema,
  minRating: ratingSchema.optional(),
  tags: z.array(z.string().trim().min(1)).max(10).optional(),
});

export const trackBrowsingEventSchema = z.object({
  userId: identifierSchema,
  productId: identifierSchema,
  category: z.string().trim().min(1).max(80),
  eventType: z.enum(BROWSING_EVENT_TYPES).default('VIEW'),
  // Champ libre : c'est la souplesse du NoSQL rendue accessible par l'API.
  metadata: z.record(z.unknown()).optional(),
});

export const recommendationsSchema = z.object({
  userId: identifierSchema,
  limit: z.number().int().min(1).max(50).default(env.RECO_DEFAULT_LIMIT),
});

export type CreateReviewInput = z.infer<typeof createReviewSchema>;
export type UpdateReviewInput = z.infer<typeof updateReviewSchema>;
export type ListReviewsInput = z.infer<typeof listReviewsSchema>;
export type TrackBrowsingEventInput = z.infer<typeof trackBrowsingEventSchema>;
