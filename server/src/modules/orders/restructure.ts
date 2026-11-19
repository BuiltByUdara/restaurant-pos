import mongoose from 'mongoose';
import { z } from 'zod';
import { calculateOrderTotals } from '@restaurant/shared';
import { OrderModel } from './model.js';
import { Payment } from '../billing/models.js';
import { ConfigurationRevision, TableModel } from '../configuration/models.js';
import { AuditLog } from '../auth/models.js';
import { AppError } from '../../lib/errors.js';
const idSchema = z.string().regex(/^[a-f\d]{24}$/i);
async function eligible(id: string, version: number, session: mongoose.ClientSession) {
  const order = await OrderModel.findById(id).session(session);
  if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found.');
  if (order.version !== version)
    throw new AppError(409, 'VERSION_CONFLICT', 'Order changed. Reload before continuing.');
  if (
    !['OPEN', 'SERVED'].includes(order.status) ||
    order.bill ||
    (await Payment.exists({ orderId: order._id }).session(session))
  )
    throw new AppError(
      409,
      'ORDER_LOCKED',
      'Only unpaid OPEN or SERVED orders without bill adjustments can be split or merged.',
    );
  return order;
}
async function gate(session: mongoose.ClientSession) {
  await ConfigurationRevision.updateOne({ _id: 'phase2' }, { $inc: { revision: 1 } }, { session });
}
function total(lines: unknown) {
  try {
    return calculateOrderTotals(lines).subtotalMinor;
  } catch {
    throw new AppError(
      400,
      'ORDER_LIMIT',
      'Keep at least one item in each order and stay within order limits.',
    );
  }
}
export async function splitOrder(id: string, input: unknown, actor: string) {
  idSchema.parse(id);
  const fields = z
    .object({
      version: z.number().int().min(0),
      quantities: z.array(z.number().int().min(0).max(99)).min(1).max(100),
    })
    .strict()
    .parse(input);
  return mongoose.connection.transaction(async (session) => {
    await gate(session);
    const source = await eligible(id, fields.version, session);
    if (
      fields.quantities.length !== source.lines.length ||
      fields.quantities.some((q, i) => q > source.lines[i].quantity)
    )
      throw new AppError(400, 'INVALID_SPLIT', 'Choose quantities from the current order.');
    const moved = source.lines
      .map((line, i) => ({ ...line, quantity: fields.quantities[i] }))
      .filter((line) => line.quantity > 0);
    const remaining = source.lines
      .map((line, i) => ({ ...line, quantity: line.quantity - fields.quantities[i] }))
      .filter((line) => line.quantity > 0);
    const subtotalMinor = total(moved),
      remainingTotal = total(remaining);
    const at = new Date();
    const [created] = await OrderModel.create(
      [
        {
          status: source.status,
          createdBy: actor,
          customerName: source.customerName,
          tableId: null,
          lines: moved,
          subtotalMinor,
          history: [{ action: 'split_from', sourceId: id, status: source.status, actor, at }],
        },
      ],
      { session },
    );
    source.lines = remaining;
    source.subtotalMinor = remainingTotal;
    source.version += 1;
    source.history.push({ action: 'split_to', targetId: created.id, actor, at });
    await source.save({ session });
    await AuditLog.create([{ actor, action: 'order.split', entityId: id }], { session });
    return { source, created };
  });
}
export async function mergeOrder(id: string, input: unknown, actor: string) {
  idSchema.parse(id);
  const fields = z
    .object({
      version: z.number().int().min(0),
      sourceId: idSchema,
      sourceVersion: z.number().int().min(0),
    })
    .strict()
    .parse(input);
  if (fields.sourceId.toLowerCase() === id.toLowerCase())
    throw new AppError(400, 'INVALID_MERGE', 'Choose a different source order.');
  return mongoose.connection.transaction(async (session) => {
    await gate(session);
    const target = await eligible(id, fields.version, session);
    const source = await eligible(fields.sourceId, fields.sourceVersion, session);
    if (source.status !== target.status)
      throw new AppError(409, 'STATUS_MISMATCH', 'Orders must have the same status.');
    const lines = [...target.lines, ...source.lines];
    target.subtotalMinor = total(lines);
    target.lines = lines;
    target.version += 1;
    target.history.push({ action: 'merged_from', sourceId: source.id, actor, at: new Date() });
    source.status = 'CANCELLED';
    source.version += 1;
    source.history.push({ action: 'merged_into', targetId: target.id, actor, at: new Date() });
    if (source.tableId)
      await TableModel.updateOne(
        { _id: source.tableId },
        { $set: { status: 'AVAILABLE' }, $inc: { version: 1 } },
        { session },
      );
    await target.save({ session });
    await source.save({ session });
    await AuditLog.create([{ actor, action: 'order.merged', entityId: target.id }], { session });
    return target;
  });
}
