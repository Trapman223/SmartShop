import { Prisma } from '@prisma/client';
import {
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
} from '../errors/AppError.js';

/**
 * Traduit les erreurs connues de Prisma en erreurs métier typées.
 * Sans cette traduction, une violation de contrainte remonterait en 500
 * alors qu'il s'agit d'un conflit métier légitime (409).
 */
export function translatePrismaError(error: unknown): unknown {
  // Base injoignable : défaut transitoire d'infrastructure, pas un bug.
  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P1001' || error.code === 'P1002'))
  ) {
    return new ServiceUnavailableError(
      'Base de données indisponible',
      'Le service ne peut pas joindre PostgreSQL. Réessayez dans quelques instants.',
    );
  }

  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return error;
  }

  const target = Array.isArray(error.meta?.['target'])
    ? (error.meta['target'] as string[]).join(', ')
    : undefined;

  switch (error.code) {
    // Violation de contrainte d'unicité.
    case 'P2002':
      return new ConflictError(
        'Ressource déjà existante',
        target !== undefined
          ? `Une ressource existe déjà avec la même valeur pour : ${target}.`
          : undefined,
      );

    // Violation de clé étrangère (ex. suppression d'un produit commandé).
    case 'P2003':
      return new ConflictError(
        'Ressource référencée par une autre entité',
        'La suppression est refusée car cette ressource est référencée ailleurs.',
      );

    // Enregistrement requis introuvable.
    case 'P2025':
      return new NotFoundError('Ressource introuvable');

    // Violation d'une contrainte CHECK (ex. stock >= 0).
    case 'P2010':
    case 'P2011':
      return new ConflictError(
        'Contrainte d’intégrité violée',
        'Une contrainte de la base de données a rejeté l’opération.',
      );

    default:
      return error;
  }
}
