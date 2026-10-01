import mongoose from 'mongoose';
import {
  ConflictError,
  ServiceUnavailableError,
  ValidationError,
} from '../errors/AppError.js';

/**
 * Traduit les erreurs MongoDB et Mongoose en erreurs métier typées.
 *
 * Sans cette traduction, tout remonte en INTERNAL_SERVER_ERROR : une
 * violation d'index unique — cas parfaitement normal quand deux requêtes
 * concurrentes créent le même avis — serait rapportée comme un défaut du
 * service. C'est le pendant de `translatePrismaError` côté Catalogue.
 */
export function translateMongoError(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) {
    return error;
  }

  // Base injoignable : défaut transitoire d'infrastructure, pas un bug.
  // Sous Swarm, MongoDB peut redémarrer pendant qu'un replica sert encore.
  if (
    error instanceof mongoose.Error.MongooseServerSelectionError ||
    (error instanceof Error &&
      (error.name === 'MongoNetworkError' ||
        error.name === 'MongoNotConnectedError'))
  ) {
    return new ServiceUnavailableError(
      'Base de données indisponible',
      'Le service ne peut pas joindre MongoDB. Réessayez dans quelques instants.',
    );
  }

  // Violation d'index unique (userId, productId) : l'avis existe déjà.
  const candidate = error as { code?: unknown; keyValue?: unknown };
  if (candidate.code === 11000) {
    const keys =
      typeof candidate.keyValue === 'object' && candidate.keyValue !== null
        ? Object.keys(candidate.keyValue).join(', ')
        : undefined;

    return new ConflictError(
      'Ressource déjà existante',
      keys !== undefined
        ? `Une ressource existe déjà avec la même valeur pour : ${keys}.`
        : 'Une ressource identique existe déjà.',
    );
  }

  // Validation du schéma Mongoose (seconde ligne de défense après zod).
  if (error instanceof mongoose.Error.ValidationError) {
    const details = Object.values(error.errors)
      .map((issue) => `${issue.path} : ${issue.message}`)
      .join(' ; ');

    return new ValidationError(`Entrée invalide — ${details}`, details);
  }

  // Valeur impossible à convertir vers le type attendu par le schéma.
  if (error instanceof mongoose.Error.CastError) {
    return new ValidationError(
      `Entrée invalide — ${error.path} : valeur inexploitable`,
      `La valeur fournie pour « ${error.path} » n’est pas du type attendu.`,
    );
  }

  return error;
}
