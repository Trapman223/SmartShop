import DataLoader from 'dataloader';
import { BATCH_LIMIT, fetchProductsByReferences } from './catalogue.client.js';
import type { CatalogueProduct } from './catalogue.client.js';
import { logger } from '../lib/logger.js';

/**
 * Batching du flux 1 — obligatoire (cf. CLAUDE.md section 2).
 *
 * Sans DataLoader, une requête `productsReviews(limit: 20) { product { name } }`
 * déclencherait 20 appels HTTP vers `catalogue-api` : le N+1 classique. Le
 * loader accumule les références demandées pendant le tick courant de la
 * boucle d'événements, puis n'émet qu'un seul `GET /products/batch`.
 *
 * Le loader est instancié **par requête** (cf. `buildContext`), jamais au
 * niveau du module : son cache ne doit pas survivre à la requête, sinon un
 * prix ou un stock modifié entre-temps serait servi périmé.
 */
export type ProductLoader = DataLoader<string, CatalogueProduct | null>;

export function createProductLoader(traceId: string): ProductLoader {
  return new DataLoader<string, CatalogueProduct | null>(
    async (references) => {
      try {
        const byReference = await fetchProductsByReferences(references, traceId);

        // DataLoader exige un résultat par clé, dans l'ordre des clés. Une
        // référence inconnue du catalogue devient `null` : ce n'est pas une
        // erreur, l'avis reste parfaitement valide sans son produit.
        return references.map((reference) => byReference.get(reference) ?? null);
      } catch (error) {
        /**
         * Mode dégradé — symétrique du fallback du flux 2.
         *
         * Si `catalogue-api` est injoignable, la requête GraphQL n'échoue
         * pas : seuls les champs `product` valent `null`. Les avis, les notes
         * et les recommandations — qui ne dépendent que de MongoDB — restent
         * servis. C'est la propriété recherchée dans une architecture
         * distribuée : la panne d'un service n'emporte pas l'autre.
         *
         * Journalisé en `warn` avec le traceId : la dégradation reste visible
         * dans les logs Portainer, elle n'est pas silencieuse.
         */
        logger.warn(
          { error, traceId, references: references.length },
          'flux 1 dégradé : catalogue-api injoignable, champs product à null',
        );

        return references.map(() => null);
      }
    },
    {
      // Le catalogue refuse au-delà de 100 références par appel : au-delà,
      // DataLoader découpe de lui-même en plusieurs requêtes.
      maxBatchSize: BATCH_LIMIT,
    },
  );
}
