import { beforeAll, afterAll, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { initializeConfiguration } from '../server/src/modules/configuration/models';
import { initializeBilling, Payment } from '../server/src/modules/billing/models';
import { openShift, closeShift } from '../server/src/modules/billing/shifts';
import {
  recordCashPayment,
  recordMovement,
  adjustBill,
} from '../server/src/modules/billing/service';
import { OrderModel } from '../server/src/modules/orders/model';
import { AuditLog } from '../server/src/modules/auth/models';
let mongo: MongoMemoryReplSet;
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: '7.0.24' } });
  await mongoose.connect(mongo.getUri());
  await initializeConfiguration();
  await initializeBilling();
  await OrderModel.init();
  await AuditLog.init();
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
it('records partial cash once, completes settlement and reconciles actual drawer cash', async () => {
  const actor = new mongoose.Types.ObjectId().toString();
  const shift = await openShift({ openingMinor: 1000 }, actor);
  await expect(openShift({ openingMinor: 0 }, actor)).rejects.toThrow('existing shift');
  const order = await OrderModel.create({
    status: 'SERVED',
    createdBy: actor,
    subtotalMinor: 1000,
    lines: [],
  });
  const body = {
    orderId: order.id,
    version: 0,
    amountMinor: 400,
    tenderedMinor: 500,
    idempotencyKey: randomUUID(),
  };
  const results = await Promise.all([
    recordCashPayment(body, actor),
    recordCashPayment(body, actor),
  ]);
  expect(results[0].id).toBe(results[1].id);
  expect(await Payment.countDocuments({ orderId: order._id })).toBe(1);
  await expect(recordCashPayment({ ...body, amountMinor: 300 }, actor)).rejects.toThrow(
    'another request',
  );
  expect((await OrderModel.findById(order.id))!.status).toBe('SERVED');
  await recordCashPayment(
    { ...body, version: 1, amountMinor: 600, tenderedMinor: 1000, idempotencyKey: randomUUID() },
    actor,
  );
  expect((await OrderModel.findById(order.id))!.status).toBe('COMPLETED');
  await expect(closeShift(shift.id, { version: 0, countedMinor: 2000 }, actor)).rejects.toThrow(
    'Reload',
  );
  const closed = await closeShift(shift.id, { version: 2, countedMinor: 1950 }, actor);
  expect(closed.expectedMinor).toBe(2000);
  expect(closed.differenceMinor).toBe(-50);
});
it('locks adjusted bills after payment and caps idempotent refunds while reconciling movements', async () => {
  const actor = new mongoose.Types.ObjectId().toString();
  const shift = await openShift({ openingMinor: 1000 }, actor);
  const order = await OrderModel.create({
    status: 'SERVED',
    createdBy: actor,
    subtotalMinor: 10000,
    lines: [],
  });
  const adjusted = await adjustBill(
    order.id,
    { version: 0, discountMinor: 1000, taxBasisPoints: 1000, serviceBasisPoints: 0 },
    actor,
  );
  expect(adjusted.bill.totalMinor).toBe(9900);
  const payment = await recordCashPayment(
    {
      orderId: order.id,
      version: 1,
      amountMinor: 9900,
      tenderedMinor: 10000,
      idempotencyKey: randomUUID(),
    },
    actor,
  );
  await expect(adjustBill(order.id, { version: 2, discountMinor: 0 }, actor)).rejects.toThrow();
  const refund = {
    kind: 'REFUND',
    paymentId: payment.id,
    amountMinor: 900,
    reason: 'Returned dish',
    idempotencyKey: randomUUID(),
  };
  const one = await recordMovement(refund, actor, true);
  expect((await recordMovement(refund, actor, true)).id).toBe(one.id);
  await expect(
    recordMovement({ ...refund, amountMinor: 9900, idempotencyKey: randomUUID() }, actor, true),
  ).rejects.toThrow('exceeds');
  await recordMovement(
    { kind: 'OUT', amountMinor: 100, reason: 'Petty cash', idempotencyKey: randomUUID() },
    actor,
    false,
  );
  await recordMovement(
    { kind: 'IN', amountMinor: 200, reason: 'Float topup', idempotencyKey: randomUUID() },
    actor,
    false,
  );
  const closed = await closeShift(shift.id, { version: 4, countedMinor: 10100 }, actor);
  expect(closed.expectedMinor).toBe(10100);
  expect(closed.differenceMinor).toBe(0);
});
