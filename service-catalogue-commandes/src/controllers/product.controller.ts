import type { Request, Response } from 'express';
import * as productService from '../services/product.service.js';
import { validated } from '../middlewares/validate.js';
import type {
  CreateProductInput,
  ListProductsQuery,
  ReplaceProductInput,
} from '../validators/product.validator.js';

/**
 * Les contrôleurs ne contiennent que de l'adaptation HTTP : lecture des
 * valeurs validées, appel du service, choix du code de statut.
 * Aucune logique métier ici (cf. CLAUDE.md section 5, règle 7).
 */

export async function list(_req: Request, res: Response): Promise<void> {
  const query = validated<ListProductsQuery>(res, 'query');
  const result = await productService.listProducts(query);

  res.status(200).json(result);
}

export async function getById(_req: Request, res: Response): Promise<void> {
  const { id } = validated<{ id: string }>(res, 'params');
  const product = await productService.getProductById(id);

  res.status(200).json({ data: product });
}

export async function getBatch(_req: Request, res: Response): Promise<void> {
  const { refs } = validated<{ refs: string[] }>(res, 'query');
  const products = await productService.getProductsByReferences(refs);

  res.status(200).json({ data: products });
}

export async function create(_req: Request, res: Response): Promise<void> {
  const input = validated<CreateProductInput>(res, 'body');
  const product = await productService.createProduct(input);

  res.status(201).location(`/products/${product.id}`).json({ data: product });
}

export async function replace(_req: Request, res: Response): Promise<void> {
  const { id } = validated<{ id: string }>(res, 'params');
  const input = validated<ReplaceProductInput>(res, 'body');
  const product = await productService.replaceProduct(id, input);

  res.status(200).json({ data: product });
}

export async function remove(_req: Request, res: Response): Promise<void> {
  const { id } = validated<{ id: string }>(res, 'params');
  await productService.deleteProduct(id);

  res.status(204).send();
}
