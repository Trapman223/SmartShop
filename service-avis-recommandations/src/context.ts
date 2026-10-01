import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { createProductLoader } from './clients/product.loader.js';
import type { ProductLoader } from './clients/product.loader.js';

/**
 * Contexte GraphQL transmis à chaque resolver.
 *
 * `loaders.product` porte le flux 1 : il résout les champs `Product` auprès
 * de `catalogue-api` en un seul appel HTTP par requête, sans N+1
 * (cf. CLAUDE.md section 2).
 */
export interface GraphQLContext {
  traceId: string;
  customerId: string | undefined;
  loaders: {
    product: ProductLoader;
  };
}

export async function buildContext({
  req,
}: {
  req: Request;
}): Promise<GraphQLContext> {
  const incoming = req.get('x-request-id');
  const customerId = req.get('x-customer-id');
  const traceId = incoming !== undefined && incoming !== '' ? incoming : randomUUID();

  return Promise.resolve({
    traceId,
    customerId: customerId !== undefined && customerId !== '' ? customerId : undefined,
    // Instancié par requête : le cache du loader ne doit jamais fuiter
    // d'une requête à l'autre.
    loaders: {
      product: createProductLoader(traceId),
    },
  });
}
