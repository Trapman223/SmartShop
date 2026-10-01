import { Router } from 'express';
import type { Request, Response } from 'express';
import { SERVICE_NAME, env } from '../config/env.js';
import { isDatabaseReachable, isSchemaReady } from '../db/prisma.js';

export const healthRoutes = Router();

/**
 * Liveness — le process répond.
 * Cible du HEALTHCHECK Docker (cf. CLAUDE.md section 9, règle 8).
 */
healthRoutes.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: SERVICE_NAME,
    environment: env.NODE_ENV,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Readiness — PostgreSQL est joignable.
 * Distinct de /health : Swarm peut démarrer l'API avant la base.
 */
healthRoutes.get('/ready', async (_req: Request, res: Response) => {
  const databaseReachable = await isDatabaseReachable();
  // Le schéma n'est interrogé que si la base répond : inutile d'enchaîner
  // deux requêtes vouées à échouer.
  const schemaReady = databaseReachable ? await isSchemaReady() : false;
  const ready = databaseReachable && schemaReady;

  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not-ready',
    service: SERVICE_NAME,
    checks: {
      postgresql: databaseReachable ? 'up' : 'down',
      // « pending » : la base répond mais les migrations n'ont pas encore été
      // appliquées. Distinguer les deux cas rend le diagnostic immédiat dans
      // Portainer, sans avoir à ouvrir les logs.
      schema: schemaReady ? 'ready' : databaseReachable ? 'pending' : 'unknown',
    },
    timestamp: new Date().toISOString(),
  });
});
