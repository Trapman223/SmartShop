import { Schema, model } from 'mongoose';
import type { InferSchemaType } from 'mongoose';

/**
 * Avis client sur un produit.
 *
 * `productId` est l'identifiant du produit dans le service Catalogue &
 * Commandes. Les deux services restent découplés : aucune clé étrangère,
 * aucune jointure — la cohérence est assurée par convention, pas par la base.
 */
const reviewSchema = new Schema(
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
    rating: {
      type: Number,
      required: [true, 'rating est obligatoire'],
      min: [1, 'la note doit être comprise entre 1 et 5'],
      max: [5, 'la note doit être comprise entre 1 et 5'],
      validate: {
        validator: Number.isInteger,
        message: 'la note doit être un entier',
      },
    },
    comment: {
      type: String,
      required: [true, 'comment est obligatoire'],
      trim: true,
      maxlength: [2000, 'commentaire trop long (2000 caractères maximum)'],
    },
    tags: {
      type: [String],
      default: [],
      validate: {
        validator: (tags: string[]) => tags.length <= 10,
        message: '10 tags maximum par avis',
      },
    },
  },
  {
    timestamps: true,
    collection: 'reviews',
    versionKey: false,
  },
);

// Un client ne laisse qu'un seul avis par produit : il le modifie ensuite.
reviewSchema.index({ userId: 1, productId: 1 }, { unique: true });
// Avis d'un produit, du plus récent au plus ancien.
reviewSchema.index({ productId: 1, createdAt: -1 });
// Historique des avis d'un client.
reviewSchema.index({ userId: 1, createdAt: -1 });
// Recherche par tag.
reviewSchema.index({ tags: 1 });

export type ReviewAttributes = InferSchemaType<typeof reviewSchema>;

export const ReviewModel = model('Review', reviewSchema);

// Dérivé du modèle et non de HydratedDocument<ReviewAttributes> : le schéma
// désactive versionKey, donc le document n'a pas de champ __v.
export type ReviewDocument = InstanceType<typeof ReviewModel>;
