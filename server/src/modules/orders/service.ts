import mongoose from 'mongoose';
import { z } from 'zod';
import {
  calculateOrderTotals,
  assertOrderTransition,
  orderStates,
  type OrderState,
} from '@restaurant/shared';
import {
  MenuItemModel,
  ModifierGroupModel,
  ConfigurationRevision,
  TableModel,
} from '../configuration/models.js';
import { AuditLog } from '../auth/models.js';
import { AppError } from '../../lib/errors.js';
import { OrderModel } from './model.js';

export const inputSchema = z
  .object({
    lines: z
      .array(
        z
          .object({
            menuItemId: z.string().regex(/^[a-f\d]{24}$/i),
            quantity: z.number().int().min(1).max(99),
            optionIds: z
              .array(z.string().uuid())
              .max(48)
              .refine((ids) => new Set(ids).size === ids.length),
            notes: z.string().trim().max(500),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    tableId: z
      .string()
      .regex(/^[a-f\d]{24}$/i)
      .nullable()
      .default(null),
    customerName: z.string().trim().max(120).default(''),
  })
  .strict();

export async function createOrder(input: unknown, actor: string, id?: string, version?: number) {
  const fields = inputSchema.parse(input);
  return mongoose.connection.transaction(async (session) => {
    // Serialize catalog snapshot reads against catalog edits and archiving.
    await ConfigurationRevision.updateOne(
      { _id: 'phase2' },
      { $inc: { revision: 1 } },
      { session },
    );
    const existing = id ? await OrderModel.findById(id).session(session) : null;
    if (id && !existing) throw new AppError(404, 'NOT_FOUND', 'Order not found.');
    if (existing && (existing.version !== version || existing.status !== 'OPEN'))
      throw new AppError(409, 'VERSION_CONFLICT', 'Only unchanged open orders can be edited.');
    await assignTable(existing?.tableId?.toString() || null, fields.tableId, session);
    const lines = [];
    for (const line of fields.lines) {
      const item = await MenuItemModel.findOne({
        _id: line.menuItemId,
        archivedAt: null,
        available: true,
      }).session(session);
      if (!item) throw new AppError(409, 'ITEM_UNAVAILABLE', 'A selected item is unavailable.');
      const modifiers = [];
      const accepted = new Set<string>();
      for (const groupId of item.modifierGroupIds) {
        const group = await ModifierGroupModel.findOne({ _id: groupId, archivedAt: null }).session(
          session,
        );
        if (!group)
          throw new AppError(409, 'MODIFIER_UNAVAILABLE', 'A modifier group is unavailable.');
        const selected = group.options.filter((option) => line.optionIds.includes(option.id));
        if (selected.length < group.minSelections || selected.length > group.maxSelections)
          throw new AppError(400, 'MODIFIER_SELECTION', `Check selections for ${group.name}.`);
        for (const option of selected) {
          accepted.add(option.id);
          modifiers.push({ optionId: option.id, name: option.name, priceMinor: option.priceMinor });
        }
      }
      if (accepted.size !== line.optionIds.length)
        throw new AppError(400, 'INVALID_MODIFIER', 'An option does not belong to this item.');
      lines.push({
        menuItemId: String(item._id),
        name: item.name,
        unitPriceMinor: item.priceMinor,
        quantity: line.quantity,
        modifiers,
        notes: line.notes,
      });
    }
    let subtotalMinor: number;
    try {
      subtotalMinor = calculateOrderTotals(lines).subtotalMinor;
    } catch {
      throw new AppError(400, 'ORDER_LIMIT', 'Order exceeds supported limits.');
    }
    const entry = {
      status: 'OPEN',
      action: existing ? 'edited' : 'created',
      actor,
      at: new Date(),
    };
    const order = existing || new OrderModel({ createdBy: actor });
    order.set({ lines, subtotalMinor, tableId: fields.tableId, customerName: fields.customerName });
    if (existing) order.version += 1;
    order.history.push(entry);
    await order.save({ session });
    await AuditLog.create([{ actor, action: existing ? 'order.edited' : 'order.created', entityId: String(order._id) }], {
      session,
    });
    return order;
  });
}

export async function transitionOrder(
  id: string,
  input: unknown,
  actor: string,
  approved: boolean,
) {
  z.string()
    .regex(/^[a-f\d]{24}$/i)
    .parse(id);
  const fields = z
    .object({ version: z.number().int().min(0), status: z.enum(orderStates) })
    .strict()
    .parse(input);
  return mongoose.connection.transaction(async (session) => {
    await ConfigurationRevision.updateOne(
      { _id: 'phase2' },
      { $inc: { revision: 1 } },
      { session },
    );
    const order = await OrderModel.findById(id).session(session);
    if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found.');
    if (order.version !== fields.version)
      throw new AppError(409, 'VERSION_CONFLICT', 'Order changed. Reload before continuing.');
    try {
      assertOrderTransition(order.status as OrderState, fields.status, {
        managerApproved: approved,
        paymentSettled: false,
      });
    } catch (error) {
      throw new AppError(409, 'INVALID_TRANSITION', (error as Error).message);
    }
    order.status = fields.status;
    order.history.push({ status: fields.status, actor, at: new Date() });
    if (['CANCELLED', 'VOIDED'].includes(fields.status) && order.tableId)
      await TableModel.updateOne(
        { _id: order.tableId },
        { $set: { status: 'AVAILABLE' }, $inc: { version: 1 } },
        { session },
      );
    order.version += 1;
    await order.save({ session });
    await AuditLog.create(
      [{ actor, action: `order.${fields.status.toLowerCase()}`, entityId: id }],
      { session },
    );
    return order;
  });
}

async function assignTable(
  oldId: string | null,
  newId: string | null,
  session: mongoose.ClientSession,
) {
  if (oldId === newId) return;
  if (newId) {
    const table = await TableModel.findOneAndUpdate(
      { _id: newId, archivedAt: null, status: { $in: ['AVAILABLE', 'RESERVED'] } },
      { $set: { status: 'OCCUPIED' }, $inc: { version: 1 } },
      { session },
    );
    if (!table) throw new AppError(409, 'TABLE_BUSY', 'This table is no longer available.');
  }
  if (oldId)
    await TableModel.updateOne(
      { _id: oldId },
      { $set: { status: 'AVAILABLE' }, $inc: { version: 1 } },
      { session },
    );
}

export async function transferOrder(id: string, input: unknown, actor: string) {
  z.string()
    .regex(/^[a-f\d]{24}$/i)
    .parse(id);
  const fields = z
    .object({
      version: z.number().int().min(0),
      tableId: z
        .string()
        .regex(/^[a-f\d]{24}$/i)
        .nullable(),
    })
    .strict()
    .parse(input);
  return mongoose.connection.transaction(async (session) => {
    await ConfigurationRevision.updateOne(
      { _id: 'phase2' },
      { $inc: { revision: 1 } },
      { session },
    );
    const order = await OrderModel.findById(id).session(session);
    if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found.');
    if (
      order.version !== fields.version ||
      ['COMPLETED', 'CANCELLED', 'VOIDED'].includes(order.status)
    )
      throw new AppError(409, 'VERSION_CONFLICT', 'Order changed or closed.');
    await assignTable(order.tableId?.toString() || null, fields.tableId, session);
    order.tableId = fields.tableId ? new mongoose.Types.ObjectId(fields.tableId) : null;
    order.version += 1;
    order.history.push({ action: 'transferred', tableId: fields.tableId, actor, at: new Date() });
    await order.save({ session });
    await AuditLog.create([{ actor, action: 'order.transferred', entityId: id }], { session });
    return order;
  });
}
