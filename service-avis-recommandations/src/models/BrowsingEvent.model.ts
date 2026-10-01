import { Schema, model } from 'mongoose';
import type { InferSchemaType } from 'mongoose';
import { env } from '../config/env.js';

export const BROWSING_EVENT_TYPES = [
  'VIEW',
  'SEARCH',
  'ADD_TO_CART',
  'PURCHASE',
] as const;

/**
 * Événement de navigation — historique simple alimentant les recommandations.
 *
 * `metadata` est volontairement de type Mixed, sans schéma imposé : c'est la
 * démonstration concrète de l'argument NoSQL du compte-rendu. Un événement
 * SEARCH y range un terme de recherche, un PURCHASE une quantité, sans
 * migration ni colonne supplémentaire.
 */
const browsingEventSchema = new Schema(
  {
    userId: {
      type: String,
      required: [true, 'userId est obligatoire'],
      trim: true,
      maxlength: 64,
    },
    productId: {
      type: String,
      required: [true, 'productId est obligatoire'],
      trim: true,
      maxlength: 64,
    },
    category: {
      type: String,
      required: [true, 'category est obligatoire'],
      trim: true,
      maxlength: 80,
    },
    eventType: {
      type: String,
      required: true,
      enum: {
        values: BROWSING_EVENT_TYPES,
        message: 'type d’événement inconnu : {VALUE}',
      },
      default: 'VIEW',
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'browsing_events',
    versionKey: false,
  },
);

// Historique d'un client, du plus récent au plus ancien.
browsingEventSchema.index({ userId: 1, createdAt: -1 });
// Produits co-consultés (recommandations « produits similaires »).
browsingEventSchema.index({ productId: 1, userId: 1 });
// Affinité de catégorie.
browsingEventSchema.index({ category: 1 });
// Purge automatique : l'historique de navigation n'a pas vocation à être
// conservé indéfiniment. MongoDB supprime les documents expirés tout seul.
browsingEventSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: env.BROWSING_HISTORY_TTL_DAYS * 24 * 60 * 60 },
);

export type BrowsingEventAttributes = InferSchemaType<typeof browsingEventSchema>;

export const BrowsingEventModel = model('BrowsingEvent', browsingEventSchema);

// Dérivé du modèle : versionKey désactivé, donc pas de champ __v.
export type BrowsingEventDocument = InstanceType<typeof BrowsingEventModel>;
