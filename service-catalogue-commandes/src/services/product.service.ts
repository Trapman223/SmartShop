import * as productRepository from '../repositories/product.repository.js';
import { ConflictError, NotFoundError } from '../errors/AppError.js';
import { buildMeta, buildPagination } from '../utils/pagination.js';
import type { PaginationMeta } from '../utils/pagination.js';
import { toProductDto } from '../utils/serializers.js';
import type { ProductDto } from '../utils/serializers.js';
import type {
  CreateProductInput,
  ListProductsQuery,
  ReplaceProductInput,
} from '../validators/product.validator.js';

export async function listProducts(
  query: ListProductsQuery,
): Promise<{ data: ProductDto[]; meta: PaginationMeta }> {
  const pagination = buildPagination(query.page, query.limit);
  const { items, total } = await productRepository.findMany(query, pagination);

  return {
    data: items.map(toProductDto),
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
