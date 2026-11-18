import { beforeAll, afterAll, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { PurchaseOrder, Supplier } from '../server/src/modules/inventory/models';
import { finishPurchase } from '../server/src/modules/inventory/purchasing';
import { initializeConfiguration } from '../server/src/modules/configuration/models';
import { AuditLog } from '../server/src/modules/auth/models';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  Ingredient,
  Recipe,
  StockMovement,
  initializeInventory,
} from '../server/src/modules/inventory/models';
import { consumeRecipes } from '../server/src/modules/inventory/service';
let mongo: MongoMemoryReplSet;
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: '7.0.24' } });
  await mongoose.connect(mongo.getUri());
  await initializeInventory();
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
it('receives a purchase once and does not receive cancelled orders', async () => {
  await initializeConfiguration();
  await AuditLog.init();
  const actor = new mongoose.Types.ObjectId().toString();
  const supplier = await Supplier.create({ name: 'Supplier' });
  const ingredient = await Ingredient.create({ name: 'Flour', nameKey: 'flour', unit: 'g' });
  const purchase = await PurchaseOrder.create({
    supplierId: supplier._id,
    lines: [{ ingredientId: ingredient._id, quantity: 500 }],
  });
  await finishPurchase(purchase.id, { version: 0, status: 'RECEIVED' }, actor);
  await finishPurchase(purchase.id, { version: 0, status: 'RECEIVED' }, actor);
  expect((await Ingredient.findById(ingredient.id))!.stock).toBe(500);
  expect(await StockMovement.countDocuments({ ingredientId: ingredient._id })).toBe(1);
  const cancelled = await PurchaseOrder.create({
    supplierId: supplier._id,
    lines: [{ ingredientId: ingredient._id, quantity: 100 }],
  });
  await finishPurchase(cancelled.id, { version: 0, status: 'CANCELLED' }, actor);
  await expect(
    finishPurchase(cancelled.id, { version: 1, status: 'RECEIVED' }, actor),
  ).rejects.toThrow('changed');
});
it('aggregates recipe consumption and makes repeat submission idempotent', async () => {
  const ingredient = await Ingredient.create({
    name: 'Rice',
    nameKey: 'rice',
    unit: 'g',
    stock: 1000,
  });
  const menuItemId = new mongoose.Types.ObjectId().toString(),
    orderId = new mongoose.Types.ObjectId().toString(),
    actor = new mongoose.Types.ObjectId().toString();
  await Recipe.create({
    menuItemId,
    components: [{ ingredientId: ingredient._id, quantity: 100 }],
  });
  for (let i = 0; i < 2; i++)
    await mongoose.connection.transaction((session) =>
      consumeRecipes(
        orderId,
        [
          { menuItemId, quantity: 2 },
          { menuItemId, quantity: 1 },
        ],
        actor,
        session,
      ),
    );
  expect((await Ingredient.findById(ingredient.id))!.stock).toBe(700);
  expect(await StockMovement.countDocuments({ orderId })).toBe(1);
  await expect(
    mongoose.connection.transaction((session) =>
      consumeRecipes(
        new mongoose.Types.ObjectId().toString(),
        [{ menuItemId, quantity: 8 }],
        actor,
        session,
      ),
    ),
  ).rejects.toThrow('Not enough');
  expect((await Ingredient.findById(ingredient.id))!.stock).toBe(700);
});
