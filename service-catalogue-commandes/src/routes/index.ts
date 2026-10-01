import { Router } from 'express';
import { healthRoutes } from './health.routes.js';
import { docsRoutes } from './docs.routes.js';
import { productsRoutes } from './products.routes.js';
import { ordersRoutes } from './orders.routes.js';

export const router = Router();

router.use('/', healthRoutes);
router.use('/', docsRoutes);
router.use('/products', productsRoutes);
router.use('/orders', ordersRoutes);
