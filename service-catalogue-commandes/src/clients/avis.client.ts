import { z } from 'zod';
import { env } from '../config/env.js';
import { UpstreamError } from '../errors/AppError.js';

/**
 * Flux 2 — `catalogue-api` → `avis-api` (GraphQL).
 *
 * `GET /products` enrichit chaque produit de sa note moyenne. Les avis vivent
 * dans MongoDB, qui appartient exclusivement au service Avis : ce service ne
 * s'y connecte jamais et passe par l'API GraphQL (cf. CLAUDE.md section 2).
 *
 * L'adressage utilise le nom de service Swarm `avis-api`, résolu par le DNS
 * interne du cluster, qui équilibre la charge sur les 3 replicas.
 */

/**
 * Une seule query, batchée : `productRatings` accepte N références et renvoie
 * une entrée par référence demandée — y compris pour les produits sans avis
 * (average: 0, count: 0). Cela évite tout N+1 depuis le catalogue.
 */
const PRODUCT_RATINGS_QUERY = `
  query ProductRatings($productIds: [String!]!) {
    productRatings(productIds: $productIds) {
      productId
      average
      count
    }
  }
`;

/**
 * Contrat attendu d'`avis-api`. Validé comme n'importe quelle entrée externe
 * (cf. CLAUDE.md section 5, règle 2) : la réponse d'un autre microservice
 * n'est pas plus digne de confiance qu'un corps de requête client.
 */
const ratingSchema = z.object({
  productId: z.string(),
  average: z.number(),
  count: z.number().int(),
});

const graphqlResponseSchema = z.object({
  data: z.object({ productRatings: z.array(ratingSchema) }).nullable().optional(),
  errors: z
    .array(z.object({ message: z.string() }))
    .optional(),
});

/** Note agrégée d'un produit, telle qu'exposée par `GET /products`. */
export interface ProductRating {
  average: number;
  count: number;
}

/** Plafond aligné sur la taille de page maximale du catalogue. */
export const RATINGS_BATCH_LIMIT = 100;

/**
 * Récupère les notes moyennes d'un lot de produits.
 *
 * @param references références catalogue à noter
 * @param traceId    X-Request-Id propagé, pour corréler les logs des
 *                   6 replicas dans Portainer
 * @throws UpstreamError si `avis-api` est injoignable, trop lent, en erreur,
 *         ou si sa réponse ne respecte pas le contrat attendu. L'appelant
 *         décide alors du mode dégradé.
 */
export async function fetchProductRatings(
  references: readonly string[],
  traceId: string,
): Promise<Map<string, ProductRating>> {
  if (references.length === 0) {
    return new Map();
  }

  if (references.length > RATINGS_BATCH_LIMIT) {
    throw new UpstreamError(
      'Trop de références demandées',
      `${String(references.length)} références pour un plafond de ${String(RATINGS_BATCH_LIMIT)}.`,
    );
  }

  const url = env.AVIS_SERVICE_URL;
  let response: Response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        // Propagation obligatoire de la trace sur tout appel sortant.
        'x-request-id': traceId,
      },
      body: JSON.stringify({
        query: PRODUCT_RATINGS_QUERY,
        variables: { productIds: [...references] },
      }),
      // Plafond strict : le catalogue ne doit jamais attendre indéfiniment
      // le service d'avis. Au-delà, on sert sans note plutôt que pas du tout.
      signal: AbortSignal.timeout(env.AVIS_SERVICE_TIMEOUT_MS),
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : 'cause inconnue';
    throw new UpstreamError(
      'Service d’avis indisponible',
      `Appel à ${url} échoué : ${reason}`,
    );
  }

  if (!response.ok) {
    throw new UpstreamError(
      'Service d’avis en erreur',
      `${url} a répondu ${String(response.status)}.`,
    );
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new UpstreamError(
      'Réponse du service d’avis illisible',
      `${url} n'a pas renvoyé du JSON valide.`,
    );
  }

  const parsed = graphqlResponseSchema.safeParse(payload);

  if (!parsed.success) {
    throw new UpstreamError(
      'Réponse du service d’avis inattendue',
      `${url} ne respecte pas le contrat attendu.`,
    );
  }

  // GraphQL répond 200 même en cas d'erreur applicative : le statut HTTP ne
  // suffit pas, il faut inspecter le tableau `errors`.
  if (parsed.data.errors !== undefined && parsed.data.errors.length > 0) {
    throw new UpstreamError(
      'Service d’avis en erreur',
      parsed.data.errors.map((error) => error.message).join(' ; '),
    );
  }

  const ratings = parsed.data.data?.productRatings;

  if (ratings === undefined || ratings === null) {
    throw new UpstreamError(
      'Réponse du service d’avis incomplète',
      `${url} n'a renvoyé aucune donnée productRatings.`,
    );
  }

  return new Map(
    ratings.map((rating) => [
      rating.productId,
      { average: rating.average, count: rating.count },
    ]),
  );
}
