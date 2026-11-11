import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import type { EventEmitter } from 'node:events';
import type { AuthService } from '../auth/service.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { KitchenTicket } from './model.js';
import { OrderModel } from '../orders/model.js';
import { ConfigurationRevision } from '../configuration/models.js';
import { AuditLog } from '../auth/models.js';
import { AppError } from '../../lib/errors.js';
export function kitchenRoutes(auth: AuthService, events: EventEmitter) {
  const router = Router();
  router.use(requireAuth(auth));
  router.get('/', requirePermission('kitchen:read'), async (req, res) => {
    const query = z
      .object({
        page: z.coerce.number().int().min(1).max(100000).default(1),
        history: z.enum(['true', 'false']).default('false'),
        station: z.string().trim().max(80).optional(),
      })
      .parse(req.query);
    const filter = {
      status: {
        $in: query.history === 'true' ? ['SERVED', 'VOIDED'] : ['SUBMITTED', 'PREPARING', 'READY'],
      },
      ...(query.station ? { 'lines.station': query.station } : {}),
    };
    const [items, total, stations] = await Promise.all([
      KitchenTicket.find(filter)
        .sort({ createdAt: query.history === 'true' ? -1 : 1, _id: 1 })
        .skip((query.page - 1) * 30)
        .limit(30),
      KitchenTicket.countDocuments(filter),
      KitchenTicket.distinct('lines.station'),
    ]);
    res.json({ data: { items, stations, pagination: { page: query.page, total } } });
  });
  router.patch('/:id/status', requirePermission('kitchen:write'), async (req, res) => {
    const id = z
      .string()
      .regex(/^[a-f\d]{24}$/i)
      .parse(req.params.id);
    const body = z
      .object({ version: z.number().int().min(0), status: z.enum(['PREPARING', 'READY']) })
      .strict()
      .parse(req.body);
    const ticket = await mongoose.connection.transaction(async (session) => {
      await ConfigurationRevision.updateOne(
        { _id: 'phase2' },
        { $inc: { revision: 1 } },
        { session },
      );
      const current = await KitchenTicket.findById(id).session(session);
      if (!current) throw new AppError(404, 'NOT_FOUND', 'Kitchen ticket not found.');
      const expected = body.status === 'PREPARING' ? 'SUBMITTED' : 'PREPARING';
      if (current.version !== body.version || current.status !== expected)
        throw new AppError(409, 'VERSION_CONFLICT', 'Ticket changed. Refresh before continuing.');
      const order = await OrderModel.findOne({ _id: current.orderId, status: expected }).session(
        session,
      );
      if (!order)
        throw new AppError(409, 'ORDER_CHANGED', 'Order is no longer in this preparation state.');
      order.status = body.status;
      order.version += 1;
      order.history.push({ status: body.status, actor: req.auth!.user.id, at: new Date() });
      await order.save({ session });
      current.status = body.status;
      current.version += 1;
      await current.save({ session });
      await AuditLog.create(
        [
          {
            actor: req.auth!.user.id,
            action: `kitchen.${body.status.toLowerCase()}`,
            entityId: id,
          },
        ],
        { session },
      );
      return current;
    });
    events.emit('orders:changed');
    res.json({ data: ticket });
  });
  return router;
}
