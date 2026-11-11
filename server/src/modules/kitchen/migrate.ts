import mongoose from 'mongoose';
import { KitchenTicket } from './model.js';
import { OrderModel } from '../orders/model.js';
import { ConfigurationRevision, TableModel } from '../configuration/models.js';
// Recover pre-Phase-4 active orders without rewriting existing tickets.
export async function recoverKitchenTickets() {
  await KitchenTicket.init();
  const cursor = OrderModel.find({ status: { $in: ['SUBMITTED', 'PREPARING', 'READY'] } })
    .select('_id')
    .cursor();
  for await (const entry of cursor)
    await mongoose.connection.transaction(async (session) => {
      await ConfigurationRevision.updateOne(
        { _id: 'phase2' },
        { $inc: { revision: 1 } },
        { session },
      );
      const order = await OrderModel.findById(entry._id).session(session);
      if (!order || !['SUBMITTED', 'PREPARING', 'READY'].includes(order.status)) return;
      if (await KitchenTicket.exists({ orderId: order._id }).session(session)) return;
      const table = order.tableId
        ? await TableModel.findById(order.tableId).session(session)
        : null;
      await KitchenTicket.create(
        [
          {
            orderId: order._id,
            status: order.status,
            tableName: table?.name || 'Takeaway',
            createdAt: order.history.find((h) => h.status === 'SUBMITTED')?.at || order.createdAt,
            lines: order.lines.map((line) => ({
              name: line.name,
              quantity: line.quantity,
              notes: line.notes,
              station: line.station || 'Kitchen',
              modifiers: (line.modifiers || []).map((m: { name: string }) => ({ name: m.name })),
            })),
          },
        ],
        { session },
      );
    });
}
