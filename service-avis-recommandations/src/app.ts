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
import { typeDefs } from './graphql/typeDefs.js';
import { resolvers } from './resolvers/index.js';
import { buildContext } from './context.js';
import type { GraphQLContext } from './context.js';
import { env, SERVICE_NAME } from './config/env.js';
import { isDatabaseReachable } from './db/mongoose.js';
import { logger } from './lib/logger.js';

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
    introspection: env.GRAPHQL_INTROSPECTION,
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
      origin: env.CORS_ORIGINS.includes('*') ? true : env.CORS_ORIGINS,
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
