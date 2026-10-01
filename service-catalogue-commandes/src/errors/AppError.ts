/**
 * Hiérarchie d'erreurs métier (cf. CLAUDE.md section 5, règle 6).
 * Ne jamais lever `new Error(...)` brut depuis la couche métier.
 */
export interface FieldError {
  field: string;
  message: string;
}

export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly detail: string | undefined;

  constructor(message: string, status: number, code: string, detail?: string) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/** Entrée invalide : corps, paramètre de route ou query string. */
export class ValidationError extends AppError {
  public readonly fields: readonly FieldError[];

  constructor(message: string, fields: readonly FieldError[] = [], detail?: string) {
    super(message, 400, 'VALIDATION_ERROR', detail);
    this.name = 'ValidationError';
    this.fields = fields;
  }
}

/** Corps de requête trop volumineux (limite express.json). */
export class PayloadTooLargeError extends AppError {
  constructor(message: string, detail?: string) {
    super(message, 413, 'PAYLOAD_TOO_LARGE', detail);
    this.name = 'PayloadTooLargeError';
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, detail?: string) {
    super(message, 404, 'NOT_FOUND', detail);
    this.name = 'NotFoundError';
  }
}

/** Violation d'une règle métier : stock insuffisant, commande expédiée… */
export class ConflictError extends AppError {
  constructor(message: string, detail?: string) {
    super(message, 409, 'CONFLICT', detail);
    this.name = 'ConflictError';
  }
}

/** Stock insuffisant — cas de conflit le plus fréquent, typé à part. */
export class InsufficientStockError extends AppError {
  constructor(message: string, detail?: string) {
    super(message, 409, 'INSUFFICIENT_STOCK', detail);
    this.name = 'InsufficientStockError';
  }
}

/**
 * Dépendance indisponible (base de données injoignable).
 * 503 et non 500 : le défaut est transitoire et la requête peut être rejouée.
 * Sous Swarm, PostgreSQL peut redémarrer pendant qu'un replica sert encore.
 */
export class ServiceUnavailableError extends AppError {
  constructor(message: string, detail?: string) {
    super(message, 503, 'SERVICE_UNAVAILABLE', detail);
    this.name = 'ServiceUnavailableError';
  }
}

/** Échec d'appel vers un service amont (ex. avis-api injoignable). */
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

export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}
