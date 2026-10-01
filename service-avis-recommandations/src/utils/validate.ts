import type { ZodError, ZodTypeAny, z } from 'zod';
import { ValidationError } from '../errors/AppError.js';

function describe(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(racine)';
      return `${path} : ${issue.message}`;
    })
    .join(' ; ');
}

/**
 * Valide une entrée GraphQL et renvoie la valeur typée.
 *
 * GraphQL valide déjà les TYPES (Int, String, non-null), mais pas les RÈGLES
 * MÉTIER : qu'une note soit entre 1 et 5, qu'un commentaire ne dépasse pas
 * 2000 caractères, qu'un tag soit bien formé. C'est le rôle de zod ici.
 */
export function parseInput<TSchema extends ZodTypeAny>(
  schema: TSchema,
  input: unknown,
): z.infer<TSchema> {
  const result = schema.safeParse(input);

  if (!result.success) {
    const details = describe(result.error);
    // Le détail va aussi dans le message : la plupart des clients GraphQL
    // n'affichent que `message`, et « Entrée invalide » seul n'aide personne
    // à corriger sa requête.
    throw new ValidationError(`Entrée invalide — ${details}`, details);
  }

  return result.data as z.infer<TSchema>;
}
