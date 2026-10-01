import type { Request, Response, NextFunction } from 'express';
import type { ZodError, ZodTypeAny } from 'zod';
import { ValidationError } from '../errors/AppError.js';
import type { FieldError } from '../errors/AppError.js';

type Source = 'body' | 'query' | 'params';

function toFieldErrors(error: ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : '(racine)',
    message: issue.message,
  }));
}

/**
 * Valide une partie de la requête et la remplace par la valeur typée.
 * Toute entrée externe est validée avant usage (cf. CLAUDE.md section 5,
 * règle 2) : la frontière du service est la frontière de la confiance.
 *
 * Le résultat est déposé dans `res.locals.validated`, car sous Express 5
 * `req.query` est en lecture seule.
 */
export function validate<TSchema extends ZodTypeAny>(
  source: Source,
  schema: TSchema,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      next(
        new ValidationError(
          `Requête invalide (${source})`,
          toFieldErrors(result.error),
        ),
      );
      return;
    }

    const validated = (res.locals['validated'] ?? {}) as Record<string, unknown>;
    validated[source] = result.data;
    res.locals['validated'] = validated;
    next();
  };
}

/**
 * Récupère la valeur validée déposée par `validate`.
 * Le paramètre de type est le type inféré du schéma correspondant.
 */
export function validated<TValidated>(res: Response, source: Source): TValidated {
  const bag = (res.locals['validated'] ?? {}) as Record<string, unknown>;
  return bag[source] as TValidated;
}
