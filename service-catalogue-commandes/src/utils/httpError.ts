import { PayloadTooLargeError, ValidationError } from '../errors/AppError.js';

/**
 * Traduit les erreurs levées par `express.json()` (body-parser).
 *
 * Sans cette traduction, un corps JSON malformé ou trop volumineux remonte
 * en 500 « Erreur interne du serveur » : le client croit à un défaut du
 * service alors que sa requête est en cause, et l'incident est journalisé
 * en `error` au lieu de `warn`, ce qui déclenche des alertes à tort.
 *
 * body-parser marque ses erreurs d'un champ `type` stable.
 */
export function translateBodyParserError(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) {
    return error;
  }

  const candidate = error as { type?: unknown; length?: unknown; limit?: unknown };
  const type = typeof candidate.type === 'string' ? candidate.type : undefined;

  switch (type) {
    case 'entity.parse.failed':
      return new ValidationError(
        'Corps de requête JSON invalide',
        [{ field: '(corps)', message: 'le corps de la requête n’est pas du JSON valide' }],
        'Vérifiez la syntaxe JSON et l’en-tête Content-Type: application/json.',
      );

    case 'entity.too.large':
      return new PayloadTooLargeError(
        'Corps de requête trop volumineux',
        typeof candidate.limit === 'number'
          ? `La limite est de ${String(candidate.limit)} octets.`
          : 'La limite du service est de 1 Mo.',
      );

    case 'encoding.unsupported':
      return new ValidationError(
        'Encodage de requête non supporté',
        [{ field: '(corps)', message: 'encodage non supporté' }],
        'Utilisez UTF-8.',
      );

    case 'request.aborted':
      return new ValidationError(
        'Requête interrompue par le client',
        [{ field: '(corps)', message: 'requête interrompue avant réception complète' }],
      );

    default:
      return error;
  }
}
