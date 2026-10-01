import { createApp } from './app.js';
import { env, SERVICE_NAME } from './config/env.js';
import { logger } from './lib/logger.js';
import { connectWithRetry, disconnectPrisma } from './db/prisma.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  await connectWithRetry();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, environment: env.NODE_ENV },
      `${SERVICE_NAME} démarré`,
    );
  });

  /**
   * Arrêt propre (cf. CLAUDE.md section 5, règle 9).
   * Swarm envoie SIGTERM à chaque rolling update : sans cet arrêt gracieux,
   * le `delay: 10s` de update_config ne protège de rien.
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

    // Sans cet appel, les connexions keep-alive (Connection: keep-alive,
    // timeout=5) maintiennent le serveur ouvert et `close` n'appelle jamais
    // son callback : l'arrêt attend alors le délai de grâce complet. Sous
    // Swarm, avec parallelism 1 et delay 10s, cela ajoute ~30 s à chaque
    // rolling update de 3 replicas.
    server.closeIdleConnections();

    server.close(() => {
      void disconnectPrisma()
        .then(() => {
          logger.info('arrêt propre terminé');
          process.exit(0);
        })
        .catch((error: unknown) => {
          logger.error({ error }, 'échec de la fermeture du client Prisma');
          process.exit(1);
        });
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
