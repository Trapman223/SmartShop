import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * Client Prisma unique pour tout le service.
 * Instancié au chargement du module mais SANS connexion : la connexion est
 * établie explicitement par connectWithRetry() depuis server.ts, afin que
 * l'import de app.ts en test ne nécessite aucune base de données.
 */
export const prisma = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Connexion avec retry exponentiel (cf. CLAUDE.md section 10, règle 8).
 * `depends_on` n'existe pas en Docker Swarm : l'API peut démarrer avant
 * PostgreSQL et doit donc réessayer au lieu de crasher.
 */
export async function connectWithRetry(): Promise<void> {
  const maxRetries = env.DB_CONNECT_MAX_RETRIES;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      await prisma.$connect();
      logger.info({ attempt }, 'connexion PostgreSQL établie');
      return;
    } catch (error) {
      const isLastAttempt = attempt === maxRetries;
      const delayMs = env.DB_CONNECT_BASE_DELAY_MS * 2 ** (attempt - 1);

      logger.warn(
        { attempt, maxRetries, delayMs, error },
        'connexion PostgreSQL échouée',
      );

      if (isLastAttempt) {
        throw new Error(
          `Connexion PostgreSQL impossible après ${String(maxRetries)} tentatives.`,
        );
      }
      await sleep(delayMs);
    }
  }
}

/** Sonde de readiness : la base répond-elle ? */
export async function isDatabaseReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/** Tables indispensables au fonctionnement de l'API. */
const REQUIRED_TABLES = ['products', 'orders', 'order_items'] as const;

/**
 * Le schéma attendu est-il présent ?
 *
 * `SELECT 1` ne prouve que la joignabilité de PostgreSQL : sur une base vide,
 * il réussit alors que /products et /orders échoueraient. Sous Swarm, le
 * service de migration tourne en parallèle du démarrage des replicas ; cette
 * sonde évite qu'un replica soit déclaré prêt avant que les tables existent.
 */
export async function isSchemaReady(): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<{ present: bigint }[]>`
      SELECT COUNT(*) AS present
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY(${[...REQUIRED_TABLES]}::text[])
    `;
    return Number(rows[0]?.present ?? 0) === REQUIRED_TABLES.length;
  } catch {
    return false;
  }
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
