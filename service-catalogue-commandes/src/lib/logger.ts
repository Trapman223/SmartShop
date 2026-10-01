import pino from 'pino';
import { env, SERVICE_NAME } from '../config/env.js';

/**
 * Logger JSON structuré (cf. CLAUDE.md section 5, règle 10).
 * La sortie JSON est directement lisible dans les logs Portainer.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: SERVICE_NAME },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Sans ce sérialiseur, un objet Error passé sous la clé `error`
  // est journalisé comme {} (ses propriétés ne sont pas énumérables).
  serializers: { error: pino.stdSerializers.err, err: pino.stdSerializers.err },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'DATABASE_URL'],
    remove: true,
  },
});
