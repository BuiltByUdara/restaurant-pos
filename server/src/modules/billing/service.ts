import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { calculateCashPayment, minorUnits } from '@restaurant/shared';
import { Payment, Shift } from './models.js';
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
    const balance = order.subtotalMinor - paid.reduce((sum, p) => sum + p.amountMinor, 0);
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
