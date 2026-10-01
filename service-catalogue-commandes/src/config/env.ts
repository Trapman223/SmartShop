import { z } from 'zod';
import { resolveFileSecrets } from './secrets.js';

/**
 * Point unique de lecture de process.env (cf. CLAUDE.md section 5, règle 3).
 * Aucun autre fichier du service ne doit accéder à process.env directement.
 * En cas de variable manquante ou invalide, le service refuse de démarrer.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL est obligatoire'),

  AVIS_SERVICE_URL: z.string().url().default('http://avis-api:4000/graphql'),
  AVIS_SERVICE_TIMEOUT_MS: z.coerce.number().int().positive().default(800),

  DB_CONNECT_MAX_RETRIES: z.coerce.number().int().positive().default(5),
  DB_CONNECT_BASE_DELAY_MS: z.coerce.number().int().positive().default(1000),
});

/** Variables pouvant provenir d'un secret Docker monté en fichier. */
const SECRET_KEYS = ['DATABASE_URL'] as const;

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  // Les secrets Docker Swarm arrivent en fichiers : on résout d'abord
  // DATABASE_URL_FILE avant de valider la configuration.
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
      `Configuration d'environnement invalide pour catalogue-api :\n${details}\n` +
        'Vérifier le fichier .env (voir .env.example).',
    );
  }

  return parsed.data;
}

export const env: Env = loadEnv();

export const SERVICE_NAME = 'catalogue-api';
