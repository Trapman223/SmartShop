import type { Request } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * Contexte GraphQL transmis à chaque resolver.
 *
 * 🚧 ÉTAPE 9 : y ajouter les DataLoader du client catalogue, afin que les
 *    champs `Product` soient résolus par lots et n'engendrent aucun N+1
 *    (cf. CLAUDE.md section 2, flux 1).
 */
export interface GraphQLContext {
  traceId: string;
  customerId: string | undefined;
}

export async function buildContext({
  req,
}: {
  req: Request;
}): Promise<GraphQLContext> {
  const incoming = req.get('x-request-id');
  const customerId = req.get('x-customer-id');

  return Promise.resolve({
    traceId: incoming !== undefined && incoming !== '' ? incoming : randomUUID(),
    customerId: customerId !== undefined && customerId !== '' ? customerId : undefined,
  });
}
