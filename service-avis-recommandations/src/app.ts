import express from 'express';
import type { Express } from 'express';
import cors from 'cors';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import type { Server } from 'node:http';
import type { GraphQLFormattedError } from 'graphql';
import { unwrapResolverError } from '@apollo/server/errors';
import { isAppError } from './errors/AppError.js';
import { translateMongoError } from './utils/mongoError.js';
import { securityHeaders } from './middlewares/securityHeaders.js';
import {
  createDepthLimitRule,
  createRootFieldLimitRule,
} from './graphql/limits.js';
import { typeDefs } from './graphql/typeDefs.js';
import { resolvers } from './resolvers/index.js';
import { buildContext } from './context.js';
import type { GraphQLContext } from './context.js';
import { env, SERVICE_NAME } from './config/env.js';
import { isDatabaseReachable } from './db/mongoose.js';
import { logger } from './lib/logger.js';

/**
 * Codes d'erreur émis par GraphQL et Apollo pour des fautes imputables au
 * CLIENT : requête mal formée, champ inconnu, type incorrect, variable
 * manquante.
 *
 * Ils ne révèlent aucun détail interne du service — ils décrivent la requête
 * que le client vient d'envoyer. Les masquer derrière « Erreur interne du
 * serveur » rendrait l'API inexploitable : une simple faute de frappe sur un
 * nom de champ deviendrait indiagnosticable, et chaque erreur de saisie
 * polluerait les logs en niveau `error`.
 */
const CLIENT_ERROR_CODES = new Set([
  'GRAPHQL_PARSE_FAILED',
  'GRAPHQL_VALIDATION_FAILED',
  'BAD_USER_INPUT',
  'BAD_REQUEST',
  'PERSISTED_QUERY_NOT_FOUND',
  'PERSISTED_QUERY_NOT_SUPPORTED',
  'OPERATION_RESOLUTION_FAILURE',
]);

/**
 * Apollo Server est monté sur Express plutôt qu'en mode standalone : cela
 * permet d'exposer /health et /ready sur le MÊME port que /graphql, ce qui
 * est indispensable au HEALTHCHECK Docker (cf. CLAUDE.md section 9, règle 8).
 */
export function createApolloServer(
  httpServer?: Server,
): ApolloServer<GraphQLContext> {
  return new ApolloServer<GraphQLContext>({
    typeDefs,
    resolvers,
    // Introspection laissée active : le sujet attend que le correcteur
    // explore le schéma depuis Apollo Sandbox (CLAUDE.md section 8, règle 8).
    introspection: env.GRAPHQL_INTROSPECTION,
    validationRules: [
      createDepthLimitRule(env.GRAPHQL_MAX_DEPTH),
      createRootFieldLimitRule(env.GRAPHQL_MAX_ROOT_FIELDS),
    ],
    plugins:
      httpServer !== undefined
        ? [ApolloServerPluginDrainHttpServer({ httpServer })]
        : [],
    /**
     * Traduction centralisée des erreurs.
     *
     * Les resolvers et les services lèvent des AppError typées ; Apollo les
     * enveloppe. `unwrapResolverError` retrouve l'erreur d'origine, ce qui
     * évite de parsemer les resolvers de try/catch.
     *
     * Une erreur métier (note hors bornes, avis introuvable) est journalisée
     * en `warn` : c'est un usage incorrect de l'API, pas un défaut du service.
     */
    formatError: (formatted, error): GraphQLFormattedError => {
      // Les erreurs MongoDB et Mongoose sont d'abord converties en erreurs
      // métier typées : sans cela, une violation d'index unique — cas
      // normal sous concurrence — remonterait en INTERNAL_SERVER_ERROR.
      const original = translateMongoError(unwrapResolverError(error));

      if (isAppError(original)) {
        logger.warn(
          { code: original.code, status: original.status, path: formatted.path },
          original.message,
        );

        return {
          ...formatted,
          message: original.message,
          extensions: {
            ...formatted.extensions,
            code: original.code,
            status: original.status,
            ...(original.detail !== undefined ? { detail: original.detail } : {}),
          },
        };
      }

      // Erreur imputable au client : transmise telle quelle, journalisée en
      // `warn`. C'est un usage incorrect de l'API, pas un défaut du service.
      const code = formatted.extensions?.['code'];
      if (typeof code === 'string' && CLIENT_ERROR_CODES.has(code)) {
        logger.warn({ code, path: formatted.path }, formatted.message);
        return formatted;
      }

      logger.error({ error: original }, 'erreur GraphQL non gérée');

      // Aucun stack trace renvoyé au client (cf. CLAUDE.md section 8, règle 8).
      if (env.NODE_ENV !== 'production') {
        return formatted;
      }
      return {
        message: 'Erreur interne du serveur',
        ...(formatted.path !== undefined ? { path: formatted.path } : {}),
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      };
    },
  });
}

/** Monte les sondes REST de santé et le point de terminaison GraphQL. */
export async function createApp(
  apollo: ApolloServer<GraphQLContext>,
): Promise<Express> {
  const app = express();

  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(
    cors({
      // `origin: true` RENVERRAIT l'origine de l'appelant dans
      // Access-Control-Allow-Origin. Avec « * » configuré, on veut un « * »
      // littéral : l'intention est explicite, et si des credentials étaient
      // un jour activés, un en-tête reflété deviendrait exploitable alors
      // qu'un « * » est refusé par les navigateurs dans ce cas.
      origin: env.CORS_ORIGINS.includes('*') ? '*' : env.CORS_ORIGINS,
      credentials: false,
    }),
  );

  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: SERVICE_NAME,
      environment: env.NODE_ENV,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/ready', (_req, res) => {
    const reachable = isDatabaseReachable();
    res.status(reachable ? 200 : 503).json({
      status: reachable ? 'ready' : 'not-ready',
      service: SERVICE_NAME,
      checks: { mongodb: reachable ? 'up' : 'down' },
      timestamp: new Date().toISOString(),
    });
  });

  await apollo.start();

  app.use(
    '/graphql',
    express.json({ limit: '1mb' }),
    expressMiddleware(apollo, { context: buildContext }),
  );

  return app;
}
