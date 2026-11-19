import { Router } from 'express';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { calculateBill } from '@restaurant/shared';
import type { AuthService } from '../auth/service.js';
import { requireAuth } from '../auth/middleware.js';
import { PrintJob, Payment, CashMovement } from '../billing/models.js';
import { OrderModel } from '../orders/model.js';
import { KitchenTicket } from '../kitchen/model.js';
import { TableModel, ConfigurationRevision } from '../configuration/models.js';
import { getRestaurantSettings } from '../reporting/settings.js';
import { AuditLog } from '../auth/models.js';
import { AppError } from '../../lib/errors.js';
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const amount = (value: number) => `LKR ${(value / 100).toFixed(2)}`;
export function printingRoutes(auth: AuthService) {
  const router = Router();
  router.use(requireAuth(auth));
  router.use((req, _res, next) => {
    if (!req.auth!.user.permissions.some((p) => p === 'payments:write' || p === 'kitchen:read'))
      throw new AppError(403, 'FORBIDDEN', 'Printing access required.');
    next();
  });
  const kinds = (permissions: readonly string[]) => [
    ...(permissions.includes('payments:write') ? ['RECEIPT'] : []),
    ...(permissions.includes('kitchen:read') ? ['KITCHEN'] : []),
  ];
  router.get('/', async (req, res) => {
    const page = z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.page);
    res.json({
      data: await PrintJob.find({
        actorId: req.auth!.user.id,
        kind: { $in: kinds(req.auth!.user.permissions) },
        requestKey: { $exists: true },
      })
        .select('-leaseToken')
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * 20)
        .limit(20),
    });
  });
  router.post('/', async (req, res) => {
    const fields = z
      .object({
        orderId: objectId,
        kind: z.enum(['RECEIPT', 'KITCHEN']),
        width: z.union([z.literal(58), z.literal(80)]),
        requestKey: z.string().uuid(),
      })
      .strict()
      .parse(req.body);
    if (!kinds(req.auth!.user.permissions).includes(fields.kind))
      throw new AppError(403, 'FORBIDDEN', 'This document is not available to your role.');
    const actor = req.auth!.user.id,
      settings = await getRestaurantSettings();
    const job = await mongoose.connection.transaction(async (session) => {
      await ConfigurationRevision.updateOne(
        { _id: 'phase2' },
        { $inc: { revision: 1 } },
        { session },
      );
      const existing = await PrintJob.findOne({ requestKey: fields.requestKey }).session(session);
      if (existing) {
        if (
          String(existing.actorId) !== actor ||
          String(existing.orderId) !== fields.orderId ||
          existing.kind !== fields.kind ||
          existing.width !== fields.width
        )
          throw new AppError(409, 'KEY_REUSED', 'Print request key already used.');
        return existing;
      }
      const order = await OrderModel.findById(fields.orderId).session(session);
      if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found.');
      const table = order.tableId
        ? await TableModel.findById(order.tableId).session(session)
        : null;
      const content = [
        settings.name,
        fields.kind === 'KITCHEN' ? 'KITCHEN TICKET' : 'CUSTOMER RECEIPT',
        `Order #${order.id}`,
        table?.name || 'Takeaway / separate bill',
        `Status: ${order.status}`,
        new Date().toLocaleString('en-GB', { timeZone: settings.timezone }),
        `Timezone: ${settings.timezone}`,
      ];
      if (fields.kind === 'KITCHEN') {
        const ticket = await KitchenTicket.findOne({ orderId: order._id }).session(session);
        if (!ticket) throw new AppError(409, 'NO_TICKET', 'This order has no kitchen ticket.');
        content.push(`Ticket #${ticket.id}`);
        for (const line of ticket.lines)
          content.push(
            `${line.quantity} x ${line.name} [${line.station}]`,
            ...line.modifiers.map((m: { name: string }) => `  + ${m.name}`),
            line.notes || '',
          );
      } else {
        for (const line of order.lines)
          content.push(
            `${line.quantity} x ${line.name}: ${amount(line.quantity * (line.unitPriceMinor + line.modifiers.reduce((s: number, m: { priceMinor: number }) => s + m.priceMinor, 0)))}`,
            ...line.modifiers.map((m: { name: string }) => `  + ${m.name}`),
          );
        const bill = order.bill || calculateBill(order.subtotalMinor, {});
        for (const field of [
          'subtotalMinor',
          'discountMinor',
          'taxMinor',
          'serviceMinor',
          'totalMinor',
        ])
          content.push(`${field.replace('Minor', '')}: ${amount(bill[field])}`);
        const payments = await Payment.find({ orderId: order._id }).session(session);
        const refunds = await CashMovement.find({ orderId: order._id, kind: 'REFUND' }).session(
          session,
        );
        for (const p of payments)
          content.push(
            `CASH ${amount(p.amountMinor)}; received ${amount(p.tenderedMinor)}; change ${amount(p.changeMinor)}`,
          );
        content.push(
          `Balance: ${amount(bill.totalMinor - payments.reduce((s, p) => s + p.amountMinor, 0))}`,
          `Refunds: ${amount(refunds.reduce((s, r) => s + r.amountMinor, 0))}`,
          settings.receiptFooter,
        );
      }
      const [created] = await PrintJob.create([{ ...fields, actorId: actor, content }], {
        session,
      });
      await AuditLog.create([{ actor, action: 'print.queued', entityId: created.id }], { session });
      return created;
    });
    res.status(201).json({ data: { _id: job.id } });
  });
  router.post('/:id/:action', async (req, res) => {
    const id = objectId.parse(req.params.id),
      action = z.enum(['claim', 'finish', 'retry', 'confirm']).parse(req.params.action);
    const base = {
      _id: id,
      actorId: req.auth!.user.id,
      kind: { $in: kinds(req.auth!.user.permissions) },
      requestKey: { $exists: true },
    };
    let job;
    if (action === 'finish') {
      const fields = z
        .object({ leaseToken: z.string().uuid(), status: z.enum(['DIALOG_OPENED', 'FAILED']) })
        .strict()
        .parse(req.body);
      job = await PrintJob.findOneAndUpdate(
        {
          ...base,
          status: 'PRINTING',
          leaseToken: fields.leaseToken,
          leaseUntil: { $gt: new Date() },
        },
        {
          $set: { status: fields.status },
          $unset: { leaseToken: 1, leaseUntil: 1 },
          $inc: { version: 1 },
        },
        { new: true },
      );
    } else {
      const { version } = z
        .object({ version: z.number().int().min(0) })
        .strict()
        .parse(req.body);
      if (action === 'claim')
        job = await PrintJob.findOneAndUpdate(
          { ...base, version, status: 'QUEUED' },
          {
            $set: {
              status: 'PRINTING',
              leaseToken: randomUUID(),
              leaseUntil: new Date(Date.now() + 300000),
            },
            $inc: { attempts: 1, version: 1 },
          },
          { new: true },
        );
      if (action === 'confirm')
        job = await PrintJob.findOneAndUpdate(
          { ...base, version, status: 'DIALOG_OPENED' },
          { $set: { status: 'CONFIRMED' }, $inc: { version: 1 } },
          { new: true },
        );
      if (action === 'retry')
        job = await PrintJob.findOneAndUpdate(
          {
            ...base,
            version,
            $or: [
              { status: { $in: ['FAILED', 'DIALOG_OPENED', 'CONFIRMED'] } },
              { status: 'PRINTING', leaseUntil: { $lte: new Date() } },
            ],
          },
          {
            $set: { status: 'QUEUED' },
            $unset: { leaseToken: 1, leaseUntil: 1 },
            $inc: { version: 1 },
          },
          { new: true },
        );
    }
    if (!job)
      throw new AppError(
        409,
        'PRINT_CONFLICT',
        'Job changed, is in use, or is unavailable. Refresh the queue.',
      );
    res.json({ data: job });
  });
  return router;
}
