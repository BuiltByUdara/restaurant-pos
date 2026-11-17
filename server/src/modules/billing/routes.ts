import { Router } from 'express';
import { z } from 'zod';
import type { EventEmitter } from 'node:events';
import type { AuthService } from '../auth/service.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { Shift, Payment } from './models.js';
import { openShift, closeShift } from './shifts.js';
import { recordCashPayment } from './service.js';
export function billingRoutes(auth: AuthService, events: EventEmitter) {
  const router = Router();
  router.use(requireAuth(auth), requirePermission('payments:write'));
  router.get('/shifts', async (req, res) => {
    res.json({ data: await Shift.find({ cashierId: req.auth!.user.id }).sort({ createdAt: -1 }).limit(30) });
  });
  router.post('/shifts', async (req, res) => { res.status(201).json({ data: await openShift(req.body, req.auth!.user.id) }); });
  router.post('/shifts/:id/close', async (req, res) => { res.json({ data: await closeShift(String(req.params.id), req.body, req.auth!.user.id) }); });
  router.get('/payments', async (req, res) => {
    const orderId = z.string().regex(/^[a-f\d]{24}$/i).parse(req.query.orderId);
    res.json({ data: await Payment.find({ orderId }).select('-requestHash -idempotencyKey').sort({ createdAt: 1 }).limit(1000) });
  });
  router.post('/payments/cash', async (req, res) => {
    const payment = await recordCashPayment(req.body, req.auth!.user.id);
    events.emit('orders:changed');
    res.json({ data: payment });
  });
  return router;
}
