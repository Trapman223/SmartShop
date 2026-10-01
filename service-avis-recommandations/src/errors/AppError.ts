import { GraphQLError } from 'graphql';

/**
 * Hiérarchie d'erreurs métier (cf. CLAUDE.md section 5, règle 6).
 * Ne jamais lever `new Error(...)` brut depuis la couche métier.
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly detail: string | undefined;

  constructor(message: string, status: number, code: string, detail?: string) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }

  /** Conversion en erreur GraphQL, sans fuite de détail technique. */
  toGraphQLError(): GraphQLError {
    return new GraphQLError(this.message, {
      extensions: {
        code: this.code,
        status: this.status,
        ...(this.detail !== undefined ? { detail: this.detail } : {}),
      },
    });
  }
}

export class ValidationError extends AppError {
  constructor(message: string, detail?: string) {
    super(message, 400, 'BAD_USER_INPUT', detail);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, detail?: string) {
    super(message, 404, 'NOT_FOUND', detail);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string, detail?: string) {
    super(message, 409, 'CONFLICT', detail);
    this.name = 'ConflictError';
  }
}

/**
 * Dépendance indisponible (base de données injoignable).
 * 503 et non 500 : le défaut est transitoire et la requête peut être rejouée.
 * Sous Swarm, MongoDB peut redémarrer pendant qu'un replica sert encore.
 */
export class ServiceUnavailableError extends AppError {
  constructor(message: string, detail?: string) {
    super(message, 503, 'SERVICE_UNAVAILABLE', detail);
    this.name = 'ServiceUnavailableError';
  }
}

/** Échec d'appel vers un service amont (ex. catalogue-api injoignable). */
export class UpstreamError extends AppError {
  constructor(message: string, detail?: string) {
    super(message, 502, 'UPSTREAM_ERROR', detail);
    this.name = 'UpstreamError';
  }
}

export class NotImplementedError extends AppError {
  constructor(message: string, detail?: string) {
    super(message, 501, 'NOT_IMPLEMENTED', detail);
    this.name = 'NotImplementedError';
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
