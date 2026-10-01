import { randomUUID } from 'node:crypto';
import express from 'express';
import type { Express } from 'express';
import { pinoHttp } from 'pino-http';
import { router } from './routes/index.js';
import { requestId, REQUEST_ID_HEADER } from './middlewares/requestId.js';
import { securityHeaders } from './middlewares/securityHeaders.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import { logger } from './lib/logger.js';

/**
 * Montage de l'application Express.
 * Aucune connexion base de données n'est ouverte ici : createApp() est donc
 * importable en test sans PostgreSQL.
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(securityHeaders);
  // requestId AVANT express.json : sinon une erreur de parsing du corps est
  // levée avant que l'identifiant de corrélation n'existe, et la réponse
  // d'erreur part avec traceId « unknown » — introuvable dans les logs.
  app.use(requestId);
  app.use(express.json({ limit: '1mb' }));
  app.use(
    pinoHttp({
      logger,
      // Réutilise l'identifiant posé par le middleware requestId, afin que
      // le log HTTP et les logs applicatifs partagent le même traceId.
      genReqId: (_req, res) => {
        const existing = res.getHeader(REQUEST_ID_HEADER);
        return typeof existing === 'string' ? existing : randomUUID();
      },
      autoLogging: {
        ignore: (req) => req.url === '/health' || req.url === '/ready',
      },
    }),
  );

  app.use(router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export { REQUEST_ID_HEADER };
