import { createServer } from 'node:http';
import { createApolloServer, createApp } from './app.js';
import { env, SERVICE_NAME } from './config/env.js';
import { logger } from './lib/logger.js';
import { connectWithRetry, disconnectMongoose } from './db/mongoose.js';
import { ensureIndexes } from './db/indexes.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  await connectWithRetry();
  await ensureIndexes();

  const httpServer = createServer();
  const apollo = createApolloServer(httpServer);
  const app = await createApp(apollo);

  httpServer.on('request', app);
  httpServer.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, environment: env.NODE_ENV },
      `${SERVICE_NAME} démarré — GraphQL sur /graphql`,
    );
  });

  /**
   * Arrêt propre (cf. CLAUDE.md section 5, règle 9).
   * Swarm envoie SIGTERM à chaque rolling update.
   */
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'arrêt en cours — fin des requêtes en vol');

    const forced = setTimeout(() => {
      logger.error('arrêt forcé : délai de grâce dépassé');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forced.unref();

    void apollo
      .stop()
      .then(() => disconnectMongoose())
      .then(() => {
        logger.info('arrêt propre terminé');
        process.exit(0);
      })
      .catch((error: unknown) => {
        logger.error({ error }, 'échec de l’arrêt propre');
        process.exit(1);
      });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

/**
 * Filets de dernier recours. Sans eux, une promesse rejetée hors du cycle
 * d'une requête tue le process en n'écrivant qu'une trace brute sur stderr,
 * illisible dans Portainer. On journalise en JSON avant de laisser Swarm
 * redémarrer la tâche (restart_policy).
 */
process.on('unhandledRejection', (reason: unknown) => {
  logger.fatal({ error: reason }, 'promesse rejetée non gérée');
  process.exit(1);
});

process.on('uncaughtException', (error: Error) => {
  logger.fatal({ error }, 'exception non interceptée');
  process.exit(1);
});

main().catch((error: unknown) => {
  logger.fatal({ error }, `démarrage de ${SERVICE_NAME} impossible`);
  process.exit(1);
});
