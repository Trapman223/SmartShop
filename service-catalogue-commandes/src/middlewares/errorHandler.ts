import type { Request, Response, NextFunction } from 'express';
import { isAppError, isValidationError } from '../errors/AppError.js';
import type { FieldError } from '../errors/AppError.js';
import { translatePrismaError } from '../utils/prismaError.js';
import { translateBodyParserError } from '../utils/httpError.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';

/**
 * Corps d'erreur au format RFC 7807 (Problem Details for HTTP APIs),
 * enrichi d'un `traceId` et, pour les erreurs de validation, du détail
 * par champ.
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance: string;
  traceId: string;
  errors?: readonly FieldError[];
}

/**
 * Gestionnaire d'erreurs centralisé.
 * Le client reçoit un message métier et un traceId ; le détail technique
 * part dans les logs (cf. CLAUDE.md section 8, règle 9).
 */
export function errorHandler(
  rawError: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const traceId = String(res.locals['requestId'] ?? 'unknown');
  // Les erreurs d'infrastructure sont d'abord traduites en erreurs métier
  // typées, pour qu'un corps invalide ne soit pas rapporté comme un 500.
  const error = translatePrismaError(translateBodyParserError(rawError));

  if (isAppError(error)) {
    // 4xx = erreur d'usage attendue → warn. 5xx = défaut du service → error.
    const log = error.status >= 500 ? logger.error : logger.warn;
    log.call(
      logger,
      { traceId, code: error.code, status: error.status, path: req.path },
      error.message,
    );

    const body: ProblemDetails = {
      type: `https://smartshop/errors/${error.code.toLowerCase()}`,
      title: error.message,
      status: error.status,
      instance: req.originalUrl,
      traceId,
    };
    if (error.detail !== undefined) {
      body.detail = error.detail;
    }
    if (isValidationError(error) && error.fields.length > 0) {
      body.errors = error.fields;
    }

    res.status(error.status).json(body);
    return;
  }

  logger.error({ traceId, path: req.path, error }, 'erreur non gérée');

  const body: ProblemDetails = {
    type: 'https://smartshop/errors/internal',
    title: 'Erreur interne du serveur',
    status: 500,
    instance: req.originalUrl,
    traceId,
  };
  // Le détail technique n'est exposé qu'en développement.
  if (env.NODE_ENV === 'development' && error instanceof Error) {
    body.detail = error.message;
  }

  res.status(500).json(body);
}

/** Route inconnue → 404 au format RFC 7807. */
export function notFoundHandler(req: Request, res: Response): void {
  const body: ProblemDetails = {
    type: 'https://smartshop/errors/not_found',
    title: 'Route inconnue',
    status: 404,
    detail: `${req.method} ${req.originalUrl}`,
    instance: req.originalUrl,
    traceId: String(res.locals['requestId'] ?? 'unknown'),
  };
  res.status(404).json(body);
}
