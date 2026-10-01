import type { Request, Response, NextFunction } from 'express';

/**
 * En-têtes de sécurité de base (cf. CLAUDE.md section 8).
 *
 * Écrit à la main plutôt qu'avec `helmet` : l'API ne sert que du JSON et une
 * unique page de documentation, quatre en-têtes suffisent. Cela évite une
 * dépendance supplémentaire dans l'image (CLAUDE.md section 0, règle
 * transverse sur les dépendances).
 *
 * La CSP n'est pas posée ici : elle casserait Swagger UI sur /docs, qui
 * charge ses ressources depuis un CDN. La route /docs pose la sienne.
 */
export function securityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Empêche le navigateur de deviner un type MIME différent de celui annoncé.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Interdit l'affichage de l'API dans une iframe (clickjacking).
  res.setHeader('X-Frame-Options', 'DENY');
  // Ne fuite pas l'URL complète vers des origines tierces.
  res.setHeader('Referrer-Policy', 'no-referrer');
  // Aucune API de périphérique n'est nécessaire.
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  next();
}
