import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Connexion avec retry exponentiel (cf. CLAUDE.md section 10, règle 8).
 * `depends_on` n'existe pas en Docker Swarm : l'API peut démarrer avant
 * MongoDB et doit donc réessayer au lieu de crasher.
 */
export async function connectWithRetry(): Promise<void> {
  const maxRetries = env.DB_CONNECT_MAX_RETRIES;

  mongoose.set('strictQuery', true);

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      await mongoose.connect(env.MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
        // Les index sont créés explicitement par ensureIndexes() au
        // démarrage. Laisser autoIndex actif ferait retenter leur création
        // à chaque usage de modèle, sur chacun des 3 replicas.
        autoIndex: false,
        maxPoolSize: 10,
        minPoolSize: 1,
      });
      logger.info({ attempt }, 'connexion MongoDB établie');
      return;
    } catch (error) {
      const isLastAttempt = attempt === maxRetries;
      const delayMs = env.DB_CONNECT_BASE_DELAY_MS * 2 ** (attempt - 1);

      logger.warn(
        { attempt, maxRetries, delayMs, error },
        'connexion MongoDB échouée',
      );

      if (isLastAttempt) {
        throw new Error(
          `Connexion MongoDB impossible après ${String(maxRetries)} tentatives.`,
        );
      }
      await sleep(delayMs);
    }
  }
}

/** Sonde de readiness : la base répond-elle ? (1 = connected) */
export function isDatabaseReachable(): boolean {
  return mongoose.connection.readyState === 1;
}

export async function disconnectMongoose(): Promise<void> {
  await mongoose.disconnect();
}

/**
 * 🚧 ÉTAPE 6 — création des index au démarrage :
 *   reviews : unique (productRef, customerId), (productRef, createdAt desc),
 *             (customerId, createdAt desc), index texte (title, comment), tags
 *   browsing_events : (customerId, at desc), index TTL sur `at` (90 jours)
 */
