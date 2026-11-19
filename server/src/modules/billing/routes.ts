import { Router } from 'express';
import { z } from 'zod';
import type { EventEmitter } from 'node:events';
import type { AuthService } from '../auth/service.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { Shift, Payment, CashMovement, PrintJob } from './models.js';
import { OrderModel } from '../orders/model.js';
import { calculateBill } from '@restaurant/shared';
import { AppError } from '../../lib/errors.js';
import { openShift, closeShift } from './shifts.js';
import { recordCashPayment, adjustBill, recordMovement } from './service.js';
export function billingRoutes(auth: AuthService, events: EventEmitter) {
  const router = Router();
  router.use(requireAuth(auth), requirePermission('payments:write'));
  router.get('/print-jobs', async (req, res) => {
    res.json({
      data: await PrintJob.find({ actorId: req.auth!.user.id })
        .select('-leaseToken')
        .sort({ createdAt: -1 })
        .limit(30),
    });
  });
  router.post('/print-jobs', async (req, res) => {
    const fields = z
      .object({
        orderId: z.string().regex(/^[a-f\d]{24}$/i),
        width: z.union([z.literal(58), z.literal(80)]),
      })
      .strict()
      .parse(req.body);
    if (!(await OrderModel.exists({ _id: fields.orderId })))
      throw new AppError(404, 'NOT_FOUND', 'Order not found.');
    res
      .status(201)
      .json({ data: await PrintJob.create({ ...fields, actorId: req.auth!.user.id }) });
  });
  router.patch('/print-jobs/:id', async (req, res) => {
    const id = z
      .string()
      .regex(/^[a-f\d]{24}$/i)
      .parse(req.params.id);
    const body = z
      .object({ status: z.enum(['DIALOG_OPENED', 'FAILED']) })
      .strict()
      .parse(req.body);
    const job = await PrintJob.findOneAndUpdate(
      { _id: id, actorId: req.auth!.user.id, requestKey: { $exists: false } },
      { $set: body },
      { new: true },
    );
    if (!job) throw new AppError(404, 'NOT_FOUND', 'Print job not found.');
    res.json({ data: job });
  });
  router.get('/orders/:id', async (req, res) => {
    const id = z
      .string()
      .regex(/^[a-f\d]{24}$/i)
      .parse(req.params.id);
    const order = await OrderModel.findById(id);
    if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found.');
    const payments = await Payment.find({ orderId: id })
      .select('-requestHash -idempotencyKey')
      .sort({ createdAt: 1 });
    const refunds = await CashMovement.find({ orderId: id, kind: 'REFUND' }).select(
      '-requestHash -idempotencyKey',
    );
    const bill = order.bill || calculateBill(order.subtotalMinor, {});
    res.json({
      data: {
        order,
        bill,
        payments,
        refunds,
        balanceMinor: bill.totalMinor - payments.reduce((s, p) => s + p.amountMinor, 0),
      },
    });
  });
  router.put('/orders/:id/bill', requirePermission('orders:approve'), async (req, res) => {
    const order = await adjustBill(String(req.params.id), req.body, req.auth!.user.id);
    events.emit('orders:changed');
    res.json({ data: order });
  });
  router.post('/refunds', requirePermission('refunds:approve'), async (req, res) => {
    res.json({ data: await recordMovement(req.body, req.auth!.user.id, true) });
  });
  router.post('/movements', async (req, res) => {
    res.json({ data: await recordMovement(req.body, req.auth!.user.id, false) });
  });
  router.get('/movements', async (req, res) => {
    res.json({
      data: await CashMovement.find({ actorId: req.auth!.user.id })
        .select('-requestHash -idempotencyKey')
        .sort({ createdAt: -1 })
        .limit(100),
    });
  });
  router.get('/shifts', async (req, res) => {
    res.json({
      data: await Shift.find({ cashierId: req.auth!.user.id }).sort({ createdAt: -1 }).limit(30),
    });
  });
  router.post('/shifts', async (req, res) => {
    res.status(201).json({ data: await openShift(req.body, req.auth!.user.id) });
  });
  router.post('/shifts/:id/close', async (req, res) => {
    res.json({ data: await closeShift(String(req.params.id), req.body, req.auth!.user.id) });
  });
  router.get('/payments', async (req, res) => {
    const orderId = z
      .string()
      .regex(/^[a-f\d]{24}$/i)
      .parse(req.query.orderId);
    res.json({
      data: await Payment.find({ orderId })
        .select('-requestHash -idempotencyKey')
        .sort({ createdAt: 1 })
        .limit(1000),
    });
  });
  router.post('/payments/cash', async (req, res) => {
    const payment = await recordCashPayment(req.body, req.auth!.user.id);
    events.emit('orders:changed');
    res.json({ data: payment });
  });
  return router;
}
