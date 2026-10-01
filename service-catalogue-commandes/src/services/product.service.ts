import * as productRepository from '../repositories/product.repository.js';
import { ConflictError, NotFoundError } from '../errors/AppError.js';
import { fetchProductRatings } from '../clients/avis.client.js';
import type { ProductRating } from '../clients/avis.client.js';
import { logger } from '../lib/logger.js';
import { buildMeta, buildPagination } from '../utils/pagination.js';
import type { PaginationMeta } from '../utils/pagination.js';
import { toProductDto } from '../utils/serializers.js';
import type { ProductDto } from '../utils/serializers.js';
import type {
  CreateProductInput,
  ListProductsQuery,
  ReplaceProductInput,
} from '../validators/product.validator.js';

/**
 * Produit du catalogue enrichi de sa note moyenne (flux 2).
 *
 * `rating` est nullable à dessein : il vaut `null` lorsque `avis-api` est
 * indisponible — mode dégradé — comme lorsque le produit n'a reçu aucun avis.
 * Les deux cas se distinguent dans les logs, pas dans la réponse : pour un
 * client du catalogue, « pas de note disponible » suffit.
 */
export interface ProductWithRatingDto extends ProductDto {
  rating: ProductRating | null;
}

/**
 * Flux 2 — enrichissement par les notes d'`avis-api`.
 *
 * Un seul appel GraphQL pour toute la page, jamais un par produit. En cas de
 * panne du service d'avis, le catalogue reste servi avec `rating: null`
 * plutôt que de renvoyer une erreur : c'est la propriété exigée par
 * CLAUDE.md section 2, et le cœur de la démonstration de résilience.
 */
async function withRatings(
  products: readonly ProductDto[],
  traceId: string,
): Promise<ProductWithRatingDto[]> {
  if (products.length === 0) {
    return [];
  }

  try {
    const ratings = await fetchProductRatings(
      products.map((product) => product.reference),
      traceId,
    );

    return products.map((product) => ({
      ...product,
      rating: ratings.get(product.reference) ?? null,
    }));
  } catch (error) {
    // Dégradation volontaire, journalisée en `warn` avec le traceId : elle
    // reste visible dans Portainer, elle n'est pas silencieuse.
    logger.warn(
      { error, traceId, products: products.length },
      'flux 2 dégradé : avis-api injoignable, notes à null',
    );

    return products.map((product) => ({ ...product, rating: null }));
  }
}

export async function listProducts(
  query: ListProductsQuery,
  traceId: string,
): Promise<{ data: ProductWithRatingDto[]; meta: PaginationMeta }> {
  const pagination = buildPagination(query.page, query.limit);
  const { items, total } = await productRepository.findMany(query, pagination);

  return {
    data: await withRatings(items.map(toProductDto), traceId),
    meta: buildMeta(pagination, total),
  };
}

export async function getProductById(id: string): Promise<ProductDto> {
  const product = await productRepository.findById(id);

  if (product === null) {
    throw new NotFoundError(
      'Produit introuvable',
      `Aucun produit ne correspond à l’identifiant ${id}.`,
    );
  }

  return toProductDto(product);
}

/** Consommé par avis-api pour résoudre les champs `Product` (flux 1). */
export async function getProductsByReferences(
  references: readonly string[],
): Promise<ProductDto[]> {
  const products = await productRepository.findManyByReferences(references);
  return products.map(toProductDto);
}

export async function createProduct(
  input: CreateProductInput,
): Promise<ProductDto> {
  const product = await productRepository.create({
    reference: input.reference,
    name: input.name,
    description: input.description ?? null,
    price: input.price,
    stock: input.stock,
  });

  return toProductDto(product);
}

export async function replaceProduct(
  id: string,
  input: ReplaceProductInput,
): Promise<ProductDto> {
  const existing = await productRepository.findById(id);

  if (existing === null) {
    throw new NotFoundError(
      'Produit introuvable',
      `Aucun produit ne correspond à l’identifiant ${id}.`,
    );
  }

  const product = await productRepository.replace(id, {
    reference: input.reference,
    name: input.name,
    description: input.description ?? null,
    price: input.price,
    stock: input.stock,
  });

  return toProductDto(product);
}

export async function deleteProduct(id: string): Promise<void> {
  const existing = await productRepository.findById(id);

  if (existing === null) {
    throw new NotFoundError(
      'Produit introuvable',
      `Aucun produit ne correspond à l’identifiant ${id}.`,
    );
  }

  // Vérification explicite plutôt que d'attendre la violation de clé
  // étrangère : le message d'erreur est bien plus parlant pour le client.
  const referencingItems = await productRepository.countOrderItems(id);

  if (referencingItems > 0) {
    throw new ConflictError(
      'Produit référencé par des commandes',
      `Ce produit apparaît dans ${String(referencingItems)} ligne(s) de commande et ne peut pas être supprimé.`,
    );
  }

  await productRepository.remove(id);
}
