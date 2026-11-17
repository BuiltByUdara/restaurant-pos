import mongoose from 'mongoose';
import { z } from 'zod';
import { minorUnits, reconcileCash } from '@restaurant/shared';
import { Shift, Payment, CashMovement } from './models.js';
import { ConfigurationRevision } from '../configuration/models.js';
import { AuditLog } from '../auth/models.js';
import { AppError } from '../../lib/errors.js';

export async function openShift(input: unknown, actor: string) {
  const fields = z.object({ openingMinor: minorUnits }).strict().parse(input);
  return mongoose.connection.transaction(async (session) => {
    await ConfigurationRevision.updateOne(
      { _id: 'phase2' },
      { $inc: { revision: 1 } },
      { session },
    );
    if (await Shift.exists({ cashierId: actor, status: 'OPEN' }).session(session))
      throw new AppError(409, 'SHIFT_OPEN', 'Close your existing shift first.');
    const [shift] = await Shift.create([{ cashierId: actor, openingMinor: fields.openingMinor }], {
      session,
    });
    await AuditLog.create([{ actor, action: 'shift.opened', entityId: shift.id }], { session });
    return shift;
  });
}

export async function closeShift(id: string, input: unknown, actor: string) {
  z.string()
    .regex(/^[a-f\d]{24}$/i)
    .parse(id);
  const fields = z
    .object({ version: z.number().int().min(0), countedMinor: minorUnits })
    .strict()
    .parse(input);
  return mongoose.connection.transaction(async (session) => {
    await ConfigurationRevision.updateOne(
      { _id: 'phase2' },
      { $inc: { revision: 1 } },
      { session },
    );
    const shift = await Shift.findOne({ _id: id, cashierId: actor }).session(session);
    if (!shift) throw new AppError(404, 'SHIFT_NOT_FOUND', 'Your shift was not found.');
    if (shift.status !== 'OPEN' || shift.version !== fields.version)
      throw new AppError(409, 'SHIFT_CHANGED', 'Reload the shift before closing it.');
    const payments = await Payment.find({ shiftId: shift._id, method: 'CASH' }).session(session);
    const movements = await CashMovement.find({ shiftId: shift._id }).session(session);
    const sum = (kind: string) =>
      movements.filter((m) => m.kind === kind).reduce((s, m) => s + m.amountMinor, 0);
    const totals = reconcileCash({
      openingMinor: shift.openingMinor,
      paymentsMinor: payments.reduce((sum, payment) => sum + payment.amountMinor, 0),
      refundsMinor: sum('REFUND'),
      cashInMinor: sum('IN'),
      cashOutMinor: sum('OUT'),
      countedMinor: fields.countedMinor,
    });
    shift.set({ ...totals, status: 'CLOSED', closedAt: new Date(), version: shift.version + 1 });
    await shift.save({ session });
    await AuditLog.create([{ actor, action: 'shift.closed', entityId: shift.id }], { session });
    return shift;
  });
}
