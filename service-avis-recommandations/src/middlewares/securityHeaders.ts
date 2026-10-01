import type { Request, Response, NextFunction } from 'express';

/**
 * En-têtes de sécurité de base (cf. CLAUDE.md section 8).
 * Identiques à ceux du service Catalogue, pour que les deux API se
 * comportent pareil derrière le même réseau overlay.
 */
export function securityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  next();
}
