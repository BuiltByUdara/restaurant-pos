import { Router } from 'express';
import type { EventEmitter } from 'node:events';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { createOrder, transitionOrder, transferOrder } from './service.js';
import { AppError } from '../../lib/errors.js';
import { OrderModel } from './model.js';
export function orderRoutes(auth: AuthService, events: EventEmitter) {
  const router = Router();
  router.use(requireAuth(auth));
  router.use((req, res, next) => {
    res.on('finish', () => {
      if (req.method !== 'GET' && res.statusCode < 300) events.emit('orders:changed');
    });
    next();
  });
  router.get('/', requirePermission('orders:read'), async (req, res) => {
    const page = z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.page);
    const [items, total] = await Promise.all([
      OrderModel.find()
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * 30)
        .limit(30),
      OrderModel.countDocuments(),
    ]);
    res.json({ data: { items, pagination: { page, limit: 30, total } } });
  });
  router.post('/', requirePermission('orders:write'), async (req, res) => {
    res.status(201).json({ data: await createOrder(req.body, req.auth!.user.id) });
  });
  router.get('/:id', requirePermission('orders:read'), async (req, res) => {
    const id = z
      .string()
      .regex(/^[a-f\d]{24}$/i)
      .parse(req.params.id);
    const order = await OrderModel.findById(id);
    if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found.');
    res.json({ data: order });
  });
  router.put('/:id', requirePermission('orders:write'), async (req, res) => {
    const id = z
      .string()
      .regex(/^[a-f\d]{24}$/i)
      .parse(req.params.id);
    const { version, ...fields } = req.body;
    res.json({
      data: await createOrder(
        fields,
        req.auth!.user.id,
        id,
        z.number().int().min(0).parse(version),
      ),
    });
  });
  router.patch('/:id/table', requirePermission('orders:write'), async (req, res) => {
    res.json({ data: await transferOrder(String(req.params.id), req.body, req.auth!.user.id) });
  });
  router.patch('/:id/status', requirePermission('orders:write'), async (req, res) => {
    res.json({
      data: await transitionOrder(
        String(req.params.id),
        req.body,
        req.auth!.user.id,
        req.auth!.user.permissions.includes('orders:approve'),
      ),
    });
  });
  return router;
}
