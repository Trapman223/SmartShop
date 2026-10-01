import { z } from 'zod';
import { resolveFileSecrets } from './secrets.js';

/**
 * Point unique de lecture de process.env (cf. CLAUDE.md section 5, règle 3).
 * Aucun autre fichier du service ne doit accéder à process.env directement.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI est obligatoire'),

  CATALOGUE_SERVICE_URL: z.string().url().default('http://catalogue-api:3000'),
  CATALOGUE_SERVICE_TIMEOUT_MS: z.coerce.number().int().positive().default(800),

  GRAPHQL_INTROSPECTION: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  // Origines autorisées, séparées par des virgules. « * » ouvre à tous —
  // acceptable en développement et pour la démonstration, à restreindre
  // dès qu'une interface web réelle consomme l'API.
  CORS_ORIGINS: z
    .string()
    .default('*')
    .transform((value) => value.split(',').map((origin) => origin.trim())),

  // --- Recommandations : pondérations et bornes, toutes configurables ---
  BROWSING_HISTORY_TTL_DAYS: z.coerce.number().int().positive().default(90),
  RECO_WEIGHT_RATING: z.coerce.number().min(0).max(1).default(0.5),
  RECO_WEIGHT_CATEGORY: z.coerce.number().min(0).max(1).default(0.3),
  RECO_WEIGHT_SIMILAR: z.coerce.number().min(0).max(1).default(0.2),
  RECO_MIN_REVIEWS: z.coerce.number().int().min(1).default(1),
  RECO_DEFAULT_LIMIT: z.coerce.number().int().min(1).max(50).default(10),

  DB_CONNECT_MAX_RETRIES: z.coerce.number().int().positive().default(5),
  DB_CONNECT_BASE_DELAY_MS: z.coerce.number().int().positive().default(1000),
});

/** Variables pouvant provenir d'un secret Docker monté en fichier. */
const SECRET_KEYS = ['MONGODB_URI'] as const;

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  // Les secrets Docker Swarm arrivent en fichiers : on résout d'abord
  // MONGODB_URI_FILE avant de valider la configuration.
  const source = resolveFileSecrets(process.env, SECRET_KEYS);

  // Réinjection dans process.env : les bibliothèques tierces lisent
  // l'environnement directement, sans passer par ce module. Prisma, par
  // exemple, résout lui-même `env("DATABASE_URL")` depuis son schéma — sans
  // cette étape il échoue en P1012 alors que la configuration est valide ici.
  for (const key of SECRET_KEYS) {
    const value = source[key];
    if (value !== undefined) {
      process.env[key] = value;
    }
  }

  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')} : ${issue.message}`)
      .join('\n');
    throw new Error(
      `Configuration d'environnement invalide pour avis-api :\n${details}\n` +
        'Vérifier le fichier .env (voir .env.example).',
    );
  }

  return parsed.data;
}

export const env: Env = loadEnv();

export const SERVICE_NAME = 'avis-api';
