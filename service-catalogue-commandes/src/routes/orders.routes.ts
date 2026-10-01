import { Router } from 'express';
import * as orderController from '../controllers/order.controller.js';
import { validate } from '../middlewares/validate.js';
import { idParamSchema } from '../validators/common.validator.js';
import {
  createOrderSchema,
  listOrdersQuerySchema,
  updateOrderStatusSchema,
} from '../validators/order.validator.js';

export const ordersRoutes = Router();

/** GET /orders — commandes paginées, filtrables par statut et par client. */
ordersRoutes.get(
  '/',
  validate('query', listOrdersQuerySchema),
  orderController.list,
);

/** GET /orders/:id */
ordersRoutes.get(
  '/:id',
  validate('params', idParamSchema),
  orderController.getById,
);

/**
 * POST /orders — création transactionnelle.
 * Vérifie l'existence des produits et le stock, calcule le montant, crée la
 * commande et ses lignes, décrémente le stock : le tout sous verrou
 * pessimiste, dans une seule transaction.
 */
ordersRoutes.post(
  '/',
  validate('body', createOrderSchema),
  orderController.create,
);

/** PATCH /orders/:id/status — transitions PENDING → CONFIRMED → SHIPPED. */
ordersRoutes.patch(
  '/:id/status',
  validate('params', idParamSchema),
  validate('body', updateOrderStatusSchema),
  orderController.updateStatus,
);

/** DELETE /orders/:id — annulation avec restitution transactionnelle du stock. */
ordersRoutes.delete(
  '/:id',
  validate('params', idParamSchema),
  orderController.remove,
);
