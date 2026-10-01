import { z } from 'zod';
import { env } from '../config/env.js';
import { UpstreamError } from '../errors/AppError.js';

/**
 * Flux 1 — `avis-api` → `catalogue-api` (REST).
 *
 * Ce service ne connaît du catalogue que des références opaques
 * (`SS-PRD-00123`) : il n'a aucun accès à PostgreSQL et ne fait aucune
 * jointure inter-base (cf. CLAUDE.md section 2). Les champs `Product` des
 * types GraphQL sont donc résolus à chaud, par appel HTTP, sur
 * `GET /products/batch?refs=...`.
 *
 * L'adressage passe par le nom de service Swarm (`catalogue-api`), jamais par
 * une IP ni par `localhost` : le DNS interne de Swarm équilibre alors la
 * charge sur les 3 replicas du catalogue.
 */

/**
 * Réponse attendue de `catalogue-api`. La frontière du service est la
 * frontière de la confiance (cf. CLAUDE.md section 5, règle 2) : la réponse
 * d'un autre microservice est validée comme n'importe quelle entrée externe.
 * Les champs non déclarés ici (`createdAt`, `updatedAt`…) sont écartés par
 * zod : ce service n'en expose aucun.
 */
const catalogueProductSchema = z.object({
  id: z.string().min(1),
  reference: z.string().min(1),
  name: z.string(),
  description: z.string().nullable(),
  // Montant transporté en chaîne : un flottant perdrait la précision
  // décimale du NUMERIC PostgreSQL (cf. CLAUDE.md section 5, règle 8).
  price: z.string(),
  stock: z.number().int(),
  available: z.boolean(),
});

const batchResponseSchema = z.object({
  data: z.array(catalogueProductSchema),
});

export type CatalogueProduct = z.infer<typeof catalogueProductSchema>;

/**
 * Plafond imposé par `catalogue-api` sur `GET /products/batch`
 * (cf. `batchProductsQuerySchema` côté catalogue). Le DataLoader découpe les
 * lots sur cette même valeur : dépasser produirait un 400.
 */
export const BATCH_LIMIT = 100;

/** `http://catalogue-api:3000/` → `http://catalogue-api:3000` */
function baseUrl(): string {
  return env.CATALOGUE_SERVICE_URL.replace(/\/+$/, '');
}

/**
 * Récupère un lot de produits par leurs références.
 *
 * Le résultat est indexé par référence : `catalogue-api` ne renvoie que les
 * produits existants, et dans un ordre qui ne nous est pas garanti. C'est à
 * l'appelant d'associer chaque référence demandée à son produit — ou à son
 * absence.
 *
 * @param references références à résoudre (au plus {@link BATCH_LIMIT})
 * @param traceId    X-Request-Id propagé, pour corréler les logs des
 *                   6 replicas dans Portainer (cf. CLAUDE.md section 2)
 * @throws UpstreamError si le catalogue est injoignable, trop lent, en
 *         erreur, ou si sa réponse ne respecte pas le contrat attendu
 */
export async function fetchProductsByReferences(
  references: readonly string[],
  traceId: string,
): Promise<Map<string, CatalogueProduct>> {
  if (references.length === 0) {
    return new Map();
  }

  const url = `${baseUrl()}/products/batch?refs=${encodeURIComponent(references.join(','))}`;

  let response: Response;

  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        // Propagation obligatoire de la trace sur tout appel sortant.
        'x-request-id': traceId,
      },
      // `AbortSignal.timeout` couvre l'établissement de la connexion ET la
      // lecture de la réponse. Sans plafond, un replica de catalogue-api
      // bloqué retiendrait indéfiniment un resolver GraphQL.
      signal: AbortSignal.timeout(env.CATALOGUE_SERVICE_TIMEOUT_MS),
    });
  } catch (cause) {
    // DNS introuvable, connexion refusée, ou dépassement du délai.
    const reason = cause instanceof Error ? cause.message : 'cause inconnue';
    throw new UpstreamError(
      'Catalogue indisponible',
      `Appel à ${url} échoué : ${reason}`,
    );
  }

  if (!response.ok) {
    throw new UpstreamError(
      'Catalogue en erreur',
      `${url} a répondu ${String(response.status)}.`,
    );
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new UpstreamError(
      'Réponse du catalogue illisible',
      `${url} n'a pas renvoyé du JSON valide.`,
    );
  }

  const parsed = batchResponseSchema.safeParse(payload);

  if (!parsed.success) {
    throw new UpstreamError(
      'Réponse du catalogue inattendue',
      `${url} ne respecte pas le contrat attendu : ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')} ${issue.message}`)
        .join(', ')}.`,
    );
  }

  return new Map(parsed.data.data.map((product) => [product.reference, product]));
}
