import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Génère ou propage X-Request-Id (cf. CLAUDE.md section 2).
 * Indispensable pour corréler les logs des 6 replicas dans Portainer.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get(REQUEST_ID_HEADER);
  const id = incoming !== undefined && incoming !== '' ? incoming : randomUUID();

  res.locals['requestId'] = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
}
