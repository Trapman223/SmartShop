import { z } from 'zod';
import { paginationQuerySchema, uuidSchema } from './common.validator.js';

const orderItemSchema = z.object({
  productId: uuidSchema,
  quantity: z
    .number()
    .int('la quantité doit être un entier')
    .min(1, 'la quantité doit être supérieure à zéro')
    .max(1000, 'quantité hors limites (1000 maximum par ligne)'),
});

/** POST /orders */
export const createOrderSchema = z.object({
  customerName: z
    .string()
    .trim()
    .min(1, 'le nom du client est obligatoire')
    .max(200, 'nom du client trop long (200 caractères maximum)'),
  items: z
    .array(orderItemSchema)
    .min(1, 'une commande doit contenir au moins une ligne')
    .max(50, '50 lignes maximum par commande'),
});

export const orderStatusSchema = z.enum([
  'PENDING',
  'CONFIRMED',
  'SHIPPED',
  'CANCELLED',
]);

/** PATCH /orders/:id/status */
export const updateOrderStatusSchema = z.object({
  status: orderStatusSchema,
});

export const listOrdersQuerySchema = paginationQuerySchema.extend({
  status: orderStatusSchema.optional(),
  customerName: z.string().trim().min(1).max(200).optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;
export type OrderStatusInput = z.infer<typeof orderStatusSchema>;
