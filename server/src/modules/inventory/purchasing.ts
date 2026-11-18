import mongoose from 'mongoose';
import { z } from 'zod';
import { Ingredient, PurchaseOrder, StockMovement } from './models.js';
import { ConfigurationRevision } from '../configuration/models.js';
import { AuditLog } from '../auth/models.js';
import { AppError } from '../../lib/errors.js';
export async function finishPurchase(id: string, input: unknown, actor: string) {
  z.string()
    .regex(/^[a-f\d]{24}$/i)
    .parse(id);
  const fields = z
    .object({ version: z.number().int().min(0), status: z.enum(['RECEIVED', 'CANCELLED']) })
    .strict()
    .parse(input);
  return mongoose.connection.transaction(async (session) => {
    await ConfigurationRevision.updateOne(
      { _id: 'phase2' },
      { $inc: { revision: 1 } },
      { session },
    );
    const order = await PurchaseOrder.findById(id).session(session);
    if (!order) throw new AppError(404, 'NOT_FOUND', 'Purchase order not found.');
    if (order.status === fields.status && order.version === fields.version + 1) return order;
    if (order.status !== 'OPEN' || order.version !== fields.version)
      throw new AppError(409, 'VERSION_CONFLICT', 'Purchase order changed.');
    if (fields.status === 'RECEIVED')
      for (const line of order.lines) {
        const ingredient = await Ingredient.findOneAndUpdate(
          { _id: line.ingredientId, stock: { $lte: 1_000_000_000 - line.quantity } },
          { $inc: { stock: line.quantity, version: 1 } },
          { session },
        );
        if (!ingredient)
          throw new AppError(409, 'STOCK_LIMIT', 'Ingredient missing or stock limit exceeded.');
        await StockMovement.create(
          [
            {
              ingredientId: line.ingredientId,
              delta: line.quantity,
              kind: 'RECEIVE',
              reason: `Purchase order ${id}`,
              actorId: actor,
              key: `purchase:${id}:${line.ingredientId}`,
            },
          ],
          { session },
        );
      }
    order.status = fields.status;
    order.version += 1;
    await order.save({ session });
    await AuditLog.create(
      [{ actor, action: `purchase.${fields.status.toLowerCase()}`, entityId: id }],
      { session },
    );
    return order;
  });
}
