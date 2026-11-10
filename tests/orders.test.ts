import { beforeAll, afterAll, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createOrder, transitionOrder, transferOrder } from '../server/src/modules/orders/service';
import { OrderModel } from '../server/src/modules/orders/model';
import {
  initializeConfiguration,
  MenuItemModel,
  TableModel,
} from '../server/src/modules/configuration/models';
import { AuditLog } from '../server/src/modules/auth/models';
import { changeRecord } from '../server/src/modules/configuration/service';
let mongo: MongoMemoryReplSet;
const actor = new mongoose.Types.ObjectId().toString();
let item: string, table: string;
const payload = () => ({
  lines: [{ menuItemId: item, quantity: 2, optionIds: [], notes: 'No salt' }],
});
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: '7.0.24' } });
  await mongoose.connect(mongo.getUri());
  await initializeConfiguration();
  await OrderModel.init();
  await AuditLog.init();
  const product = await MenuItemModel.create({
    name: 'Lunch',
    nameKey: 'lunch',
    categoryId: new mongoose.Types.ObjectId(),
    priceMinor: 1025,
  });
  item = product.id;
  table = (
    await TableModel.create({
      name: 'A1',
      nameKey: 'a1',
      floorId: new mongoose.Types.ObjectId(),
      capacity: 4,
      x: 0,
      y: 0,
    })
  ).id;
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
it('rejects client prices and unavailable products', async () => {
  await expect(createOrder({ ...payload(), subtotalMinor: 1 }, actor)).rejects.toThrow();
  await expect(
    createOrder(
      { lines: [{ ...payload().lines[0], menuItemId: new mongoose.Types.ObjectId().toString() }] },
      actor,
    ),
  ).rejects.toThrow('unavailable');
});
it('persists snapshots, edits open orders and rejects stale versions', async () => {
  const order = await createOrder(payload(), actor);
  expect(order.subtotalMinor).toBe(2050);
  await MenuItemModel.updateOne({ _id: item }, { priceMinor: 1100 });
  expect((await OrderModel.findById(order.id))!.subtotalMinor).toBe(2050);
  const updated = await createOrder(payload(), actor, order.id, 0);
  expect(updated.subtotalMinor).toBe(2200);
  await expect(createOrder(payload(), actor, order.id, 0)).rejects.toThrow('unchanged');
});
it('serializes competing table assignments and prevents manual release', async () => {
  const results = await Promise.allSettled([
    createOrder({ ...payload(), tableId: table }, actor),
    createOrder({ ...payload(), tableId: table }, actor),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const order = await OrderModel.findOne({ tableId: table });
  const current = await TableModel.findById(table);
  await expect(
    changeRecord(
      'tables',
      'status',
      { version: current!.version, status: 'AVAILABLE' },
      actor,
      'test',
      table,
    ),
  ).rejects.toThrow('active order');
  await transferOrder(order!.id, { version: 0, tableId: null }, actor);
  expect((await TableModel.findById(table))!.status).toBe('AVAILABLE');
});
it('enforces transitions, approval and payment gating with audit history', async () => {
  let order = await createOrder({ ...payload(), tableId: table }, actor);
  order = await transitionOrder(order.id, { version: 0, status: 'SUBMITTED' }, actor, false);
  await expect(createOrder(payload(), actor, order.id, 1)).rejects.toThrow('open orders');
  await expect(
    transitionOrder(order.id, { version: 1, status: 'VOIDED' }, actor, false),
  ).rejects.toThrow('Manager');
  for (const status of ['PREPARING', 'READY', 'SERVED'])
    order = await transitionOrder(order.id, { version: order.version, status }, actor, false);
  await expect(
    transitionOrder(order.id, { version: order.version, status: 'COMPLETED' }, actor, true),
  ).rejects.toThrow('payment');
  order = await transitionOrder(
    order.id,
    { version: order.version, status: 'VOIDED' },
    actor,
    true,
  );
  expect(order.history).toHaveLength(6);
  expect((await TableModel.findById(table))!.status).toBe('AVAILABLE');
  expect(await AuditLog.countDocuments({ entityId: order.id })).toBe(6);
});
it('rolls table reservation back if menu validation fails', async () => {
  await expect(
    createOrder(
      {
        tableId: table,
        lines: [{ ...payload().lines[0], optionIds: ['00000000-0000-4000-8000-000000000001'] }],
      },
      actor,
    ),
  ).rejects.toThrow();
  expect((await TableModel.findById(table))!.status).toBe('AVAILABLE');
});
