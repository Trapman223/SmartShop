import { Router } from 'express';
import * as productController from '../controllers/product.controller.js';
import { validate } from '../middlewares/validate.js';
import { idParamSchema } from '../validators/common.validator.js';
import {
  batchProductsQuerySchema,
  createProductSchema,
  listProductsQuerySchema,
  replaceProductSchema,
} from '../validators/product.validator.js';

export const productsRoutes = Router();

/** GET /products — catalogue paginé, filtrable et triable. */
productsRoutes.get(
  '/',
  validate('query', listProductsQuerySchema),
  productController.list,
);

/**
 * GET /products/batch?refs=A,B — résolution par lot.
 * ⚠️ Doit être déclarée AVANT `/:id`, sinon Express interprète « batch »
 * comme un identifiant et la validation UUID rejette la requête.
 */
productsRoutes.get(
  '/batch',
  validate('query', batchProductsQuerySchema),
  productController.getBatch,
);

/** GET /products/:id */
productsRoutes.get(
  '/:id',
  validate('params', idParamSchema),
  productController.getById,
);

/** POST /products */
productsRoutes.post(
  '/',
  validate('body', createProductSchema),
  productController.create,
);

/** PUT /products/:id — remplacement complet de la ressource. */
productsRoutes.put(
  '/:id',
  validate('params', idParamSchema),
  validate('body', replaceProductSchema),
  productController.replace,
);

/** DELETE /products/:id — refusé (409) si le produit est commandé. */
productsRoutes.delete(
  '/:id',
  validate('params', idParamSchema),
  productController.remove,
);
