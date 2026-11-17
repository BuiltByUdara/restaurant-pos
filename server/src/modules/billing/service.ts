import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  calculateCashPayment,
  calculateBill,
  billingRulesSchema,
  minorUnits,
} from '@restaurant/shared';
import { Payment, Shift, CashMovement } from './models.js';
import { OrderModel } from '../orders/model.js';
import { ConfigurationRevision, TableModel } from '../configuration/models.js';
import { AuditLog } from '../auth/models.js';
import { AppError } from '../../lib/errors.js';
export async function recordCashPayment(input: unknown, actor: string) {
  const fields = z
    .object({
      orderId: z.string().regex(/^[a-f\d]{24}$/i),
      version: z.number().int().min(0),
      amountMinor: minorUnits,
      tenderedMinor: minorUnits,
      idempotencyKey: z.string().uuid(),
    })
    .strict()
    .parse(input);
  const requestHash = createHash('sha256')
    .update(JSON.stringify({ ...fields, actor }))
    .digest('hex');
  return mongoose.connection.transaction(async (session) => {
    await ConfigurationRevision.updateOne(
      { _id: 'phase2' },
      { $inc: { revision: 1 } },
      { session },
    );
    const prior = await Payment.findOne({ idempotencyKey: fields.idempotencyKey }).session(session);
    if (prior) {
      if (prior.requestHash !== requestHash)
        throw new AppError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'This payment key belongs to another request.',
        );
      return prior;
    }
    const shift = await Shift.findOne({ cashierId: actor, status: 'OPEN' }).session(session);
    if (!shift)
      throw new AppError(409, 'SHIFT_REQUIRED', 'Open a cashier shift before accepting cash.');
    const order = await OrderModel.findById(fields.orderId).session(session);
    if (!order || order.status !== 'SERVED' || order.version !== fields.version)
      throw new AppError(409, 'ORDER_CHANGED', 'Reload a served order before taking payment.');
    const paid = await Payment.find({ orderId: order._id }).session(session);
    if (!order.bill) order.bill = calculateBill(order.subtotalMinor, {});
    const balance = order.bill.totalMinor - paid.reduce((sum, p) => sum + p.amountMinor, 0);
    let amounts;
    try {
      amounts = calculateCashPayment(balance, fields.amountMinor, fields.tenderedMinor);
    } catch (error) {
      throw new AppError(400, 'INVALID_PAYMENT', (error as Error).message);
    }
    const [payment] = await Payment.create(
      [
        {
          orderId: order._id,
          shiftId: shift._id,
          actorId: actor,
          idempotencyKey: fields.idempotencyKey,
          requestHash,
          method: 'CASH',
          amountMinor: amounts.amountMinor,
          tenderedMinor: amounts.tenderedMinor,
          changeMinor: amounts.changeMinor,
        },
      ],
      { session },
    );
    order.version += 1;
    if (amounts.remainingMinor === 0) {
      order.status = 'COMPLETED';
      order.history.push({ status: 'COMPLETED', actor, at: new Date() });
      if (order.tableId)
        await TableModel.updateOne(
          { _id: order.tableId },
          { $set: { status: 'AVAILABLE' }, $inc: { version: 1 } },
          { session },
        );
    }
    await order.save({ session });
    shift.version += 1;
    await shift.save({ session });
    await AuditLog.create([{ actor, action: 'payment.cash', entityId: payment.id }], { session });
    return payment;
  });
}

export async function adjustBill(id: string, input: unknown, actor: string) {
  z.string()
    .regex(/^[a-f\d]{24}$/i)
    .parse(id);
  const fields = billingRulesSchema.extend({ version: z.number().int().min(0) }).parse(input);
  return mongoose.connection.transaction(async (session) => {
    await ConfigurationRevision.updateOne(
      { _id: 'phase2' },
      { $inc: { revision: 1 } },
      { session },
    );
    const order = await OrderModel.findById(id).session(session);
    if (!order || order.status !== 'SERVED' || order.version !== fields.version)
      throw new AppError(409, 'ORDER_CHANGED', 'Reload a served order before adjusting its bill.');
    if (await Payment.exists({ orderId: id }).session(session))
      throw new AppError(409, 'BILL_LOCKED', 'Bills cannot change after a payment.');
    const { version, ...rules } = fields;
    try {
      order.bill = calculateBill(order.subtotalMinor, rules);
    } catch {
      throw new AppError(400, 'INVALID_BILL', 'Check discount and charge limits.');
    }
    if (order.bill.totalMinor === 0)
      throw new AppError(
        400,
        'ZERO_BILL',
        'A fully discounted order requires a complimentary-order workflow, which is not supported.',
      );
    order.version += 1;
    await order.save({ session });
    await AuditLog.create([{ actor, action: 'bill.adjusted', entityId: id }], { session });
    return order;
  });
}

export async function recordMovement(input: unknown, actor: string, refund: boolean) {
  const fields = z
    .object({
      kind: z.enum(['REFUND', 'IN', 'OUT']),
      amountMinor: minorUnits.refine((n) => n > 0),
      reason: z.string().trim().min(3).max(300),
      paymentId: z
        .string()
        .regex(/^[a-f\d]{24}$/i)
        .optional(),
      idempotencyKey: z.string().uuid(),
    })
    .strict()
    .parse(input);
  if (
    (fields.kind === 'REFUND') !== refund ||
    (refund && !fields.paymentId) ||
    (!refund && fields.paymentId)
  )
    throw new AppError(400, 'INVALID_MOVEMENT', 'Invalid movement type.');
  const requestHash = createHash('sha256')
    .update(JSON.stringify({ ...fields, actor }))
    .digest('hex');
  return mongoose.connection.transaction(async (session) => {
    await ConfigurationRevision.updateOne(
      { _id: 'phase2' },
      { $inc: { revision: 1 } },
      { session },
    );
    const prior = await CashMovement.findOne({ idempotencyKey: fields.idempotencyKey }).session(
      session,
    );
    if (prior) {
      if (prior.requestHash !== requestHash)
        throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Key belongs to another movement.');
      return prior;
    }
    const shift = await Shift.findOne({ cashierId: actor, status: 'OPEN' }).session(session);
    if (!shift) throw new AppError(409, 'SHIFT_REQUIRED', 'Open your shift first.');
    let orderId;
    if (refund) {
      const payment = await Payment.findById(fields.paymentId).session(session);
      if (!payment) throw new AppError(404, 'NOT_FOUND', 'Payment not found.');
      const refunded = await CashMovement.find({ paymentId: payment._id, kind: 'REFUND' }).session(
        session,
      );
      if (
        fields.amountMinor + refunded.reduce((sum, r) => sum + r.amountMinor, 0) >
        payment.amountMinor
      )
        throw new AppError(409, 'REFUND_LIMIT', 'Refund exceeds the unrefunded payment.');
      orderId = payment.orderId;
    }
    const [movement] = await CashMovement.create(
      [{ ...fields, requestHash, actorId: actor, shiftId: shift._id, orderId }],
      { session },
    );
    shift.version += 1;
    await shift.save({ session });
    await AuditLog.create(
      [{ actor, action: `cash.${fields.kind.toLowerCase()}`, entityId: movement.id }],
      { session },
    );
    return movement;
  });
}
