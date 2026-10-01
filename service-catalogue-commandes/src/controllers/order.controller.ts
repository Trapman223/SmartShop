import type { Request, Response } from 'express';
import * as orderService from '../services/order.service.js';
import { validated } from '../middlewares/validate.js';
import type {
  CreateOrderInput,
  ListOrdersQuery,
  OrderStatusInput,
} from '../validators/order.validator.js';

export async function list(_req: Request, res: Response): Promise<void> {
  const query = validated<ListOrdersQuery>(res, 'query');
  const result = await orderService.listOrders(query);

  res.status(200).json(result);
}

export async function getById(_req: Request, res: Response): Promise<void> {
  const { id } = validated<{ id: string }>(res, 'params');
  const order = await orderService.getOrderById(id);

  res.status(200).json({ data: order });
}

export async function create(_req: Request, res: Response): Promise<void> {
  const input = validated<CreateOrderInput>(res, 'body');
  const order = await orderService.createOrder(input);

  res.status(201).location(`/orders/${order.id}`).json({ data: order });
}

export async function updateStatus(_req: Request, res: Response): Promise<void> {
  const { id } = validated<{ id: string }>(res, 'params');
  const { status } = validated<{ status: OrderStatusInput }>(res, 'body');
  const order = await orderService.updateOrderStatus(id, status);

  res.status(200).json({ data: order });
}

export async function remove(_req: Request, res: Response): Promise<void> {
  const { id } = validated<{ id: string }>(res, 'params');
  await orderService.deleteOrder(id);

  res.status(204).send();
}
