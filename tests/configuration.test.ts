import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { RestaurantSettings } from '../server/src/modules/reporting/settings';
import { Payment, CashMovement, Shift, PrintJob } from '../server/src/modules/billing/models';
import {
  initializeInventory,
  Ingredient,
  Recipe,
  StockMovement,
  Supplier,
  PurchaseOrder,
} from '../server/src/modules/inventory/models';
import { initializeBilling } from '../server/src/modules/billing/models';
import { KitchenTicket } from '../server/src/modules/kitchen/model';
import { recoverKitchenTickets } from '../server/src/modules/kitchen/migrate';
import { OrderModel } from '../server/src/modules/orders/model';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { io as socketClient } from 'socket.io-client';
import { createApp } from '../server/src/app';
import { attachRealtime } from '../server/src/realtime';
import { Role, User, Session, AuditLog } from '../server/src/modules/auth/models';
import { passwordHash } from '../server/src/modules/auth/service';
import {
  initializeConfiguration,
  ConfigurationRevision,
} from '../server/src/modules/configuration/models';
import { models } from '../server/src/modules/configuration/repository';
import { seedDemoCatalog } from '../server/src/modules/configuration/demo';
import { rolePermissions } from '../shared/src';
import type { Config } from '../server/src/config';
let mongo: MongoMemoryReplSet,
  ownerToken: string,
  waiterToken: string,
  kitchenToken: string,
  ownerId: string;
let application: ReturnType<typeof createApp>;
const config: Config = {
  NODE_ENV: 'test',
  PORT: 4000,
  API_RATE_LIMIT_PER_MINUTE: 600,
  MONGODB_URI: '',
  JWT_SECRET: 'configuration-test-only-'.repeat(4),
  CLIENT_ORIGIN: 'http://localhost:5174',
  LOG_LEVEL: 'silent',
};
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: '7.0.24' } });
  await mongoose.connect(mongo.getUri());
  await initializeConfiguration();
  await initializeBilling();
  await RestaurantSettings.init();
  await initializeInventory();
  await KitchenTicket.init();
  await Promise.all([Role.init(), User.init(), Session.init(), AuditLog.init()]);
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
beforeEach(async () => {
  await Promise.all([
    ...Object.values(models).map((model) => model.deleteMany({})),
    Role.deleteMany({}),
    User.deleteMany({}),
    Session.deleteMany({}),
    AuditLog.deleteMany({}),
    KitchenTicket.deleteMany({}),
    OrderModel.deleteMany({}),
    RestaurantSettings.deleteMany({}),
    Payment.deleteMany({}),
    CashMovement.deleteMany({}),
    Shift.deleteMany({}),
    PrintJob.deleteMany({}),
    Ingredient.deleteMany({}),
    Recipe.deleteMany({}),
    StockMovement.deleteMany({}),
    Supplier.deleteMany({}),
    PurchaseOrder.deleteMany({}),
  ]);
  const hashed = await passwordHash('Test-configuration-123!');
  application = createApp(config);
  const tokens: string[] = [];
  for (const [index, name] of (['Owner', 'Waiter', 'Kitchen Staff'] as const).entries()) {
    const role = await Role.create({ name, permissions: rolePermissions[name] });
    const user = await User.create({
      name,
      email: `staff${index}@example.test`,
      passwordHash: hashed,
      role: role._id,
    });
    if (index === 0) ownerId = user.id;
    const login = await request(application.app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'Test-configuration-123!' })
      .expect(200);
    tokens.push(login.body.data.accessToken);
  }
  [ownerToken, waiterToken, kitchenToken] = tokens;
});
function call(
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
  body?: object,
  token = ownerToken,
) {
  const req = request(application.app)
    [method]('/api/v1/' + path)
    .auth(token, { type: 'bearer' });
  return body ? req.send(body) : req;
}
async function category(name = 'Mains') {
  return (
    await call('post', 'catalog/categories', { name, description: 'Meals', sortOrder: 0 }).expect(
      201,
    )
  ).body.data;
}
it('reports real cash inside a daylight-saving business day and protects settings', async () => {
  await call('get', 'reporting/sales?from=2026-03-08&to=2026-03-08', undefined, waiterToken).expect(
    403,
  );
  await call(
    'put',
    'reporting/settings',
    { name: 'Test Restaurant', timezone: 'America/New_York', receiptFooter: 'Thanks', version: 0 },
    waiterToken,
  ).expect(403);
  await call('put', 'reporting/settings', {
    name: 'Test Restaurant',
    timezone: 'America/New_York',
    receiptFooter: 'Thanks',
    version: 0,
  }).expect(200);
  await call('put', 'reporting/settings', {
    name: 'Other',
    timezone: 'UTC',
    receiptFooter: '',
    version: 0,
  }).expect(409);
  const shiftId = new mongoose.Types.ObjectId(),
    orderId = new mongoose.Types.ObjectId();
  for (const date of [
    '2026-03-08T04:59:59Z',
    '2026-03-08T05:00:00Z',
    '2026-03-09T03:59:59Z',
    '2026-03-09T04:00:00Z',
  ])
    await Payment.create({
      orderId,
      shiftId,
      actorId: ownerId,
      idempotencyKey: randomUUID(),
      requestHash: 'test',
      method: 'CASH',
      amountMinor: 100,
      tenderedMinor: 100,
      changeMinor: 0,
      createdAt: new Date(date),
    });
  const cat = await category();
  await OrderModel.create({
    createdBy: ownerId,
    status: 'COMPLETED',
    subtotalMinor: 240,
    createdAt: new Date('2026-03-07T12:00:00Z'),
    history: [{ status: 'COMPLETED', at: new Date('2026-03-08T12:00:00Z') }],
    lines: [
      {
        menuItemId: 'snapshot-item',
        name: 'Snapshot dish',
        categoryId: cat.id,
        quantity: 2,
        unitPriceMinor: 100,
        modifiers: [{ priceMinor: 20 }],
      },
    ],
    bill: { totalMinor: 253, discountMinor: 20, taxMinor: 23, serviceMinor: 10 },
  });
  const report = (await call('get', 'reporting/sales?from=2026-03-08&to=2026-03-08').expect(200))
    .body.data;
  expect(report.products[0]).toMatchObject({ quantity: 2, grossMinor: 240 });
  expect(report.categories[0]).toMatchObject({ quantity: 2, grossMinor: 240 });
  expect(report.charges).toMatchObject({
    completed: 1,
    totalMinor: 253,
    discountMinor: 20,
    taxMinor: 23,
    serviceMinor: 10,
  });
  expect(report.orders).toEqual([]);

  expect(report.cashMinor).toBe(200);
  expect(report.payments[0]._id).toBe('2026-03-08');
  expect(report.cashiers[0].cashMinor).toBe(200);
  await call('get', 'reporting/sales?from=2026-02-30&to=2026-03-08').expect(400);
});
it('creates staff without leaking hashes and revokes sessions on deactivation', async () => {
  await call('post', 'staff', { name: 'No access' }, waiterToken).expect(403);
  const body = {
    name: 'New Waiter',
    email: 'new@example.test',
    role: 'Waiter',
    active: true,
    password: 'Test-staff-password-123!',
  };
  const created = (await call('post', 'staff', body).expect(201)).body.data;
  expect(created.passwordHash).toBeUndefined();
  const login = await request(application.app)
    .post('/api/v1/auth/login')
    .send({ email: body.email, password: body.password })
    .expect(200);
  await call('put', `staff/${created.id}`, {
    ...body,
    active: false,
    version: created.version,
  }).expect(200);
  await call('get', 'auth/me', undefined, login.body.data.accessToken).expect(401);
  await call('put', `staff/${created.id}`, { ...body, version: created.version }).expect(409);
  const owner = await User.findById(ownerId);
  await call('put', `staff/${ownerId}`, {
    name: 'Owner',
    email: owner!.email,
    role: 'Owner',
    active: false,
    version: owner!.__v,
  }).expect(409);
});
it('protects inventory APIs, receives stock and consumes recipes atomically on submission', async () => {
  await request(application.app).get('/api/v1/inventory/ingredients').expect(401);
  await call('get', 'inventory/ingredients', undefined, waiterToken).expect(403);
  await call(
    'post',
    'inventory/ingredients',
    { name: 'Rice', unit: 'g', lowStock: 10 },
    kitchenToken,
  ).expect(403);
  const ingredient = (
    await call('post', 'inventory/ingredients', { name: 'Rice', unit: 'g', lowStock: 10 }).expect(
      201,
    )
  ).body.data;
  const movement = {
    ingredientId: ingredient._id,
    version: 0,
    kind: 'RECEIVE',
    delta: 200,
    reason: 'Opening delivery',
    key: randomUUID(),
  };
  await call('post', 'inventory/movements', movement).expect(201);
  await call('post', 'inventory/movements', movement).expect(201);
  await call('post', 'inventory/movements', { ...movement, delta: 300 }).expect(409);
  const cat = await category();
  const product = (await call('post', 'catalog/menu-items', itemFields(cat.id)).expect(201)).body
    .data;
  await call('put', `inventory/recipes/${product.id}`, {
    version: null,
    components: [{ ingredientId: ingredient._id, quantity: 100 }],
  }).expect(200);
  const order = (
    await call('post', 'orders', {
      lines: [{ menuItemId: product.id, quantity: 3, optionIds: [], notes: '' }],
    }).expect(201)
  ).body.data;
  await call('patch', `orders/${order._id}/status`, { version: 0, status: 'SUBMITTED' }).expect(
    409,
  );
  expect(await KitchenTicket.countDocuments({ orderId: order._id })).toBe(0);
  expect((await OrderModel.findById(order._id))!.status).toBe('OPEN');
  await call('post', 'inventory/movements', {
    ...movement,
    version: 1,
    delta: 100,
    key: randomUUID(),
  }).expect(201);
  await call('patch', `orders/${order._id}/status`, { version: 0, status: 'SUBMITTED' }).expect(
    200,
  );
  expect((await Ingredient.findById(ingredient._id))!.stock).toBe(0);
  await call('patch', `orders/${order._id}/status`, { version: 1, status: 'VOIDED' }).expect(200);
  expect((await Ingredient.findById(ingredient._id))!.stock).toBe(0);
});
it('requires payment permissions and separate manager approval for financial actions', async () => {
  await request(application.app).get('/api/v1/billing/shifts').expect(401);
  await call('get', 'billing/shifts', undefined, waiterToken).expect(403);
  await Role.updateOne({ name: 'Waiter' }, { $addToSet: { permissions: 'payments:write' } });
  await call('get', 'billing/shifts', undefined, waiterToken).expect(200);
  await call('post', 'billing/refunds', {}, waiterToken).expect(403);
  await call('put', 'billing/orders/000000000000000000000001/bill', {}, waiterToken).expect(403);
  await call(
    'post',
    'billing/payments/cash',
    { cardNumber: 'forbidden-field' },
    waiterToken,
  ).expect(400);
});
it('persists kitchen tickets, enforces permissions and rejects stale preparation updates', async () => {
  const cat = await category();
  const product = (await call('post', 'catalog/menu-items', itemFields(cat.id)).expect(201)).body
    .data;
  const order = (
    await call('post', 'orders', {
      lines: [{ menuItemId: product.id, quantity: 2, optionIds: [], notes: 'Allergy note' }],
    }).expect(201)
  ).body.data;
  await call('get', 'kitchen', undefined, waiterToken).expect(403);
  await call('patch', `orders/${order._id}/status`, { version: 0, status: 'SUBMITTED' }).expect(
    200,
  );
  await call('patch', `orders/${order._id}/status`, { version: 0, status: 'SUBMITTED' }).expect(
    409,
  );
  const list = (await call('get', 'kitchen?station=Kitchen', undefined, kitchenToken).expect(200))
    .body.data;
  expect(list.items).toHaveLength(1);
  expect(list.items[0].lines[0].notes).toBe('Allergy note');
  expect(list.items[0].lines[0].unitPriceMinor).toBeUndefined();
  await KitchenTicket.deleteOne({ _id: list.items[0]._id });
  await recoverKitchenTickets();
  await recoverKitchenTickets();
  const recovered = await KitchenTicket.findOne({ orderId: order._id });
  expect(await KitchenTicket.countDocuments({ orderId: order._id })).toBe(1);
  const id = recovered!.id;
  await call(
    'patch',
    `kitchen/${id}/status`,
    { version: 0, status: 'PREPARING' },
    waiterToken,
  ).expect(403);
  await call('patch', `kitchen/${id}/status`, { version: 0, status: 'READY' }, kitchenToken).expect(
    409,
  );
  await call(
    'patch',
    `kitchen/${id}/status`,
    { version: 0, status: 'PREPARING' },
    kitchenToken,
  ).expect(200);
  await call('patch', `kitchen/${id}/status`, { version: 0, status: 'READY' }, kitchenToken).expect(
    409,
  );
  await call('patch', `kitchen/${id}/status`, { version: 1, status: 'READY' }, kitchenToken).expect(
    200,
  );
  const ready = (await call('get', `orders/${order._id}`).expect(200)).body.data;
  expect(ready.status).toBe('READY');
  await call('patch', `orders/${order._id}/status`, {
    version: ready.version,
    status: 'SERVED',
  }).expect(200);
  expect(
    (await call('get', 'kitchen?history=true', undefined, kitchenToken).expect(200)).body.data
      .items[0].status,
  ).toBe('SERVED');
  expect(
    (await call('get', 'kitchen', undefined, kitchenToken).expect(200)).body.data.items,
  ).toHaveLength(0);
});
it('authorizes order APIs and persists versioned edits and details', async () => {
  await request(application.app).get('/api/v1/orders').expect(401);
  await call('get', 'orders', undefined, kitchenToken).expect(403);
  const cat = await category();
  const product = (await call('post', 'catalog/menu-items', itemFields(cat.id)).expect(201)).body
    .data;
  const body = { lines: [{ menuItemId: product.id, quantity: 1, optionIds: [], notes: '' }] };
  await call('post', 'orders', body, kitchenToken).expect(403);
  const order = (await call('post', 'orders', body, waiterToken).expect(201)).body.data;
  await call('get', `orders/${order._id}`, undefined, waiterToken).expect(200);
  await call('put', `orders/${order._id}`, { ...body, version: 0 }, waiterToken).expect(200);
  await call('put', `orders/${order._id}`, { ...body, version: 0 }, waiterToken).expect(409);
  await call(
    'patch',
    `orders/${order._id}/status`,
    { version: 1, status: 'SUBMITTED' },
    waiterToken,
  ).expect(200);
  await call(
    'patch',
    `orders/${order._id}/status`,
    { version: 2, status: 'VOIDED' },
    waiterToken,
  ).expect(409);
  await call('patch', `orders/${order._id}/status`, { version: 2, status: 'VOIDED' }).expect(200);
  expect((await call('get', 'orders?page=1').expect(200)).body.data.pagination.total).toBe(1);
});
async function floor(name = 'Main floor') {
  return (await call('post', 'dining/floors', { name, sortOrder: 0 }).expect(201)).body.data;
}
const itemFields = (categoryId: string) => ({
  name: 'House burger',
  description: 'Freshly grilled',
  categoryId,
  priceMinor: 185050,
  available: true,
  imageUrl: '',
  station: 'Kitchen',
  modifierGroupIds: [],
});
const tableFields = (floorId: string, name = 'T01', x = 0) => ({
  name,
  floorId,
  capacity: 4,
  x,
  y: 0,
  shape: 'square',
});
const groupFields = () => ({
  name: 'Extras',
  minSelections: 0,
  maxSelections: 1,
  options: [{ id: randomUUID(), name: 'Cheese', priceMinor: 15000 }],
});
describe('Phase 2 configuration', () => {
  it('upgrades built-in roles idempotently without resetting existing permissions or credentials', async () => {
    await Role.updateOne({ name: 'Owner' }, { $set: { permissions: ['staff:read'] } });
    const before = await User.findById(ownerId).select('+passwordHash');
    const migrate = () =>
      promisify(execFile)(process.execPath, ['--import', 'tsx', 'server/src/migrate-phase2.ts'], {
        env: {
          ...process.env,
          NODE_ENV: 'test',
          MONGODB_URI: mongo.getUri(),
          JWT_SECRET: config.JWT_SECRET,
          CLIENT_ORIGIN: config.CLIENT_ORIGIN,
        },
      });
    await migrate();
    await migrate();
    const role = await Role.findOne({ name: 'Owner' });
    expect(role!.permissions).toEqual(
      expect.arrayContaining([
        'staff:read',
        'menu:read',
        'menu:write',
        'tables:read',
        'tables:write',
        'tables:operate',
      ]),
    );
    expect(role!.permissions).not.toContain('settings:write');
    expect(new Set(role!.permissions).size).toBe(role!.permissions.length);
    expect((await User.findById(ownerId).select('+passwordHash'))!.passwordHash).toBe(
      before!.passwordHash,
    );
    expect(await models['menu-items'].countDocuments()).toBe(0);
  });
  it('requires authentication and separates menu editing, table editing and service permissions', async () => {
    await request(application.app).get('/api/v1/catalog/categories').expect(401);
    await call('get', 'catalog/categories', undefined, waiterToken).expect(200);
    await call('post', 'catalog/categories', { name: 'No' }, waiterToken).expect(403);
    await call('get', 'dining/floors', undefined, kitchenToken).expect(403);
    const f = await floor();
    const t = (await call('post', 'dining/tables', tableFields(f.id)).expect(201)).body.data;
    await call(
      'put',
      `dining/tables/${t.id}`,
      { ...tableFields(f.id), version: 0 },
      waiterToken,
    ).expect(403);
    await call(
      'patch',
      `dining/tables/${t.id}/status`,
      { status: 'OCCUPIED', version: 0 },
      waiterToken,
    ).expect(200);
  });
  it('creates, edits, paginates, filters and archives categories and items', async () => {
    const cat = await category();
    await category('Drinks');
    const list = await call('get', 'catalog/categories?limit=1&page=2').expect(200);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.pagination.total).toBe(2);
    const created = await call('post', 'catalog/menu-items', itemFields(cat.id)).expect(201);
    expect(created.body.data.priceMinor).toBe(185050);
    const changed = await call('put', `catalog/menu-items/${created.body.data.id}`, {
      ...itemFields(cat.id),
      priceMinor: 200099,
      available: false,
      version: 0,
    }).expect(200);
    expect(changed.body.data.version).toBe(1);
    const filtered = await call(
      'get',
      `catalog/menu-items?categoryId=${cat.id}&available=false&search=burger`,
    ).expect(200);
    expect(filtered.body.data.items).toHaveLength(1);
    await call('delete', `catalog/menu-items/${created.body.data.id}`, { version: 1 }).expect(200);
    await call('get', `catalog/menu-items/${created.body.data.id}`).expect(404);
    expect(await models['menu-items'].countDocuments()).toBe(1);
    await call('delete', `catalog/categories/${cat.id}`, { version: 0 }).expect(200);
  });
  it('rejects invalid money, invalid IDs, unsafe images and unknown fields', async () => {
    const cat = await category();
    for (const priceMinor of [-1, 1.5, 100000001])
      await call('post', 'catalog/menu-items', { ...itemFields(cat.id), priceMinor }).expect(400);
    await call('post', 'catalog/menu-items', {
      ...itemFields(cat.id),
      imageUrl: 'javascript:alert(1)',
    }).expect(400);
    await call('post', 'catalog/menu-items', { ...itemFields(cat.id), injected: true }).expect(400);
    await call('get', 'catalog/menu-items/not-an-id').expect(400);
    await call('get', 'catalog/menu-items?limit=101').expect(400);
    await call(
      'post',
      'catalog/menu-items',
      itemFields(new mongoose.Types.ObjectId().toString()),
    ).expect(409);
  });
  it('rejects duplicate active names and treats search text literally', async () => {
    await category('Mains');
    await call('post', 'catalog/categories', { name: ' mains ' }).expect(409);
    await category('Soup (hot)');
    const found = await call('get', 'catalog/categories?search=%28hot%29').expect(200);
    expect(found.body.data.items).toHaveLength(1);
    const noWildcard = await call('get', 'catalog/categories?search=.*').expect(200);
    expect(noWildcard.body.data.items).toHaveLength(0);
  });
  it('validates modifier limits, unique options and references', async () => {
    const group = groupFields();
    await call('post', 'catalog/modifier-groups', { ...group, minSelections: 2 }).expect(400);
    await call('post', 'catalog/modifier-groups', { ...group, maxSelections: 2 }).expect(400);
    await call('post', 'catalog/modifier-groups', {
      ...group,
      options: [...group.options, ...group.options],
    }).expect(400);
    const created = (await call('post', 'catalog/modifier-groups', group).expect(201)).body.data;
    const cat = await category();
    const item = (
      await call('post', 'catalog/menu-items', {
        ...itemFields(cat.id),
        modifierGroupIds: [created.id],
      }).expect(201)
    ).body.data;
    await call('delete', `catalog/modifier-groups/${created.id}`, { version: 0 }).expect(409);
    await call('put', `catalog/menu-items/${item.id}`, {
      ...itemFields(cat.id),
      version: 0,
    }).expect(200);
    await call('delete', `catalog/modifier-groups/${created.id}`, { version: 0 }).expect(200);
    await call('post', 'catalog/menu-items', {
      ...itemFields(cat.id),
      name: 'Second item',
      modifierGroupIds: [created.id],
    }).expect(409);
  });
  it('blocks archiving categories and floors that are still referenced', async () => {
    const cat = await category();
    await call('post', 'catalog/menu-items', itemFields(cat.id)).expect(201);
    await call('delete', `catalog/categories/${cat.id}`, { version: 0 }).expect(409);
    const f = await floor();
    await call('post', 'dining/tables', tableFields(f.id)).expect(201);
    await call('delete', `dining/floors/${f.id}`, { version: 0 }).expect(409);
  });
  it('returns a conflict for stale edits rather than overwriting newer data', async () => {
    const cat = await category();
    await call('put', `catalog/categories/${cat.id}`, {
      name: 'New name',
      sortOrder: 0,
      version: 0,
    }).expect(200);
    await call('put', `catalog/categories/${cat.id}`, {
      name: 'Stale name',
      sortOrder: 0,
      version: 0,
    }).expect(409);
    await call('delete', `catalog/categories/${cat.id}`, { version: 0 }).expect(409);
    const fresh = await call('get', `catalog/categories/${cat.id}`).expect(200);
    expect(fresh.body.data.name).toBe('New name');
  });
  it('enforces unique table names and positions, capacity bounds and floor moves', async () => {
    const f = await floor(),
      other = await floor('Patio');
    const t = (await call('post', 'dining/tables', tableFields(f.id)).expect(201)).body.data;
    await call('post', 'dining/tables', tableFields(f.id, 'T02')).expect(409);
    await call('post', 'dining/tables', tableFields(other.id)).expect(409);
    await call('post', 'dining/tables', { ...tableFields(f.id, 'Invalid', 2), capacity: 0 }).expect(
      400,
    );
    await call('post', 'dining/tables', { ...tableFields(f.id, 'Outside', 8) }).expect(400);
    await call('put', `dining/tables/${t.id}`, { ...tableFields(other.id), version: 0 }).expect(
      200,
    );
    await call('delete', `dining/floors/${f.id}`, { version: 0 }).expect(200);
  });
  it('validates table transitions and protects reserved and occupied tables', async () => {
    const f = await floor();
    const t = (await call('post', 'dining/tables', tableFields(f.id)).expect(201)).body.data;
    await call('patch', `dining/tables/${t.id}/status`, { status: 'RESERVED', version: 0 }).expect(
      200,
    );
    await call('delete', `dining/tables/${t.id}`, { version: 1 }).expect(409);
    await call('patch', `dining/tables/${t.id}/status`, { status: 'OCCUPIED', version: 1 }).expect(
      200,
    );
    await call('put', `dining/tables/${t.id}`, { ...tableFields(f.id), version: 2 }).expect(409);
    await call('patch', `dining/tables/${t.id}/status`, { status: 'RESERVED', version: 2 }).expect(
      409,
    );
    await call('patch', `dining/tables/${t.id}/status`, { status: 'AVAILABLE', version: 2 }).expect(
      200,
    );
    await call('delete', `dining/tables/${t.id}`, { version: 3 }).expect(200);
  });
  it('allows only one simultaneous status change at the same version', async () => {
    const f = await floor();
    const t = (await call('post', 'dining/tables', tableFields(f.id)).expect(201)).body.data;
    const results = await Promise.all(
      ['RESERVED', 'OCCUPIED'].map((status) =>
        call('patch', `dining/tables/${t.id}/status`, { status, version: 0 }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await AuditLog.countDocuments({ action: 'tables.status' })).toBe(1);
  });
  it('prevents concurrent archive/create write skew from leaving dangling references', async () => {
    const cat = await category();
    const [item, archive] = await Promise.all([
      call('post', 'catalog/menu-items', itemFields(cat.id)),
      call('delete', `catalog/categories/${cat.id}`, { version: 0 }),
    ]);
    expect([item.status, archive.status].filter((s) => s === 409)).toHaveLength(1);
    const active = await models.categories.findOne({ _id: cat.id, archivedAt: null });
    const items = await models['menu-items'].countDocuments({
      categoryId: cat.id,
      archivedAt: null,
    });
    expect(active !== null || items === 0).toBe(true);
  });
  it('rolls back a failed change and does not publish or audit it', async () => {
    const cat = await category();
    let emitted = 0;
    application.events.on('configuration:changed', () => emitted++);
    const before = await ConfigurationRevision.findById('phase2');
    await call('post', 'catalog/menu-items', {
      ...itemFields(cat.id),
      modifierGroupIds: [new mongoose.Types.ObjectId().toString()],
    }).expect(409);
    expect(await models['menu-items'].countDocuments()).toBe(0);
    expect(await AuditLog.countDocuments({ action: 'menu-items.create' })).toBe(0);
    expect(emitted).toBe(0);
    expect((await ConfigurationRevision.findById('phase2'))!.revision).toBe(before!.revision);
  });
  it('seeds a realistic catalog idempotently without overwriting edited prices', async () => {
    await seedDemoCatalog(ownerId);
    const first = await models['menu-items'].findOne({ name: 'House beef burger' });
    await models['menu-items'].updateOne({ _id: first!._id }, { $set: { priceMinor: 99999 } });
    await seedDemoCatalog(ownerId);
    expect(await models['menu-items'].countDocuments()).toBe(6);
    expect(await models.tables.countDocuments()).toBe(6);
    expect((await models['menu-items'].findById(first!._id))!.priceMinor).toBe(99999);
  });
  it('delivers committed changes only to sockets with current read permission', async () => {
    const http = createServer(application.app);
    const realtime = attachRealtime(http, application.auth, config, application.events);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
    const owner = socketClient(url, {
      auth: { token: ownerToken },
      autoConnect: false,
      reconnection: false,
    });
    const kitchen = socketClient(url, {
      auth: { token: kitchenToken },
      autoConnect: false,
      reconnection: false,
    });
    try {
      const ready = Promise.all(
        [owner, kitchen].map(
          (s) =>
            new Promise<void>((resolve) => {
              s.once('session:ready', () => resolve());
              s.connect();
            }),
        ),
      );
      await ready;
      let kitchenEvents = 0;
      kitchen.on('inventory:changed', () => kitchenEvents++);
      const inventoryEvent = new Promise<void>((resolve) =>
        owner.once('inventory:changed', () => resolve()),
      );
      await call('post', 'inventory/ingredients', {
        name: 'Socket ingredient',
        unit: 'each',
        lowStock: 1,
      }).expect(201);
      await inventoryEvent;
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(kitchenEvents).toBe(0);
      kitchen.on('tables:changed', () => kitchenEvents++);
      const event = new Promise<{ id: string }>((resolve) => owner.once('tables:changed', resolve));
      const f = await floor();
      expect((await event).id).toBe(f.id);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(kitchenEvents).toBe(0);
      await Role.updateOne({ name: 'Kitchen Staff' }, { $pull: { permissions: 'menu:read' } });
      kitchen.on('catalog:changed', () => kitchenEvents++);
      const next = new Promise((resolve) => owner.once('catalog:changed', resolve));
      await category();
      await next;
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(kitchenEvents).toBe(0);
      owner.disconnect();
      const newConnection = new Promise<void>((resolve) =>
        owner.once('session:ready', () => resolve()),
      );
      owner.connect();
      await newConnection;
      const restored = await call('get', 'dining/floors').expect(200);
      expect(restored.body.data.items[0].id).toBe(f.id);
    } finally {
      owner.disconnect();
      kitchen.disconnect();
      await new Promise<void>((resolve) => realtime.close(() => resolve()));
    }
  });
});

async function restructuringFixture(status = 'SERVED') {
  return OrderModel.create({
    createdBy: ownerId,
    status,
    subtotalMinor: 360,
    lines: [
      {
        menuItemId: new mongoose.Types.ObjectId().toString(),
        name: 'Snapshot dish',
        unitPriceMinor: 100,
        quantity: 3,
        notes: '',
        modifiers: [{ optionId: randomUUID(), name: 'Extra', priceMinor: 20 }],
      },
    ],
  });
}
it('splits and merges snapshots without changing stock, rejects stale and unauthorized operations', async () => {
  const order = await restructuringFixture();
  const ingredient = await Ingredient.create({
    name: 'Already consumed',
    nameKey: 'already consumed',
    unit: 'each',
    stock: 97,
    lowStock: 0,
  });
  await StockMovement.create({
    ingredientId: ingredient._id,
    orderId: order._id,
    actorId: ownerId,
    kind: 'CONSUME',
    delta: -3,
    reason: 'Earlier submission',
    key: randomUUID(),
  });
  await call(
    'post',
    `orders/${order.id}/split`,
    { version: 0, quantities: [1] },
    waiterToken,
  ).expect(403);
  await call('post', `orders/${order.id}/split`, { version: 0, quantities: [3] }).expect(400);
  const split = (
    await call('post', `orders/${order.id}/split`, { version: 0, quantities: [1] }).expect(200)
  ).body.data;
  expect(split.source.subtotalMinor).toBe(240);
  expect(split.created.subtotalMinor).toBe(120);
  expect(split.created.status).toBe('SERVED');
  expect(split.created.tableId).toBeNull();
  await call('post', `orders/${order.id}/split`, { version: 0, quantities: [1] }).expect(409);
  const room = await floor('Split room');
  const table = (await call('post', 'dining/tables', tableFields(room.id)).expect(201)).body.data;
  await call('patch', `orders/${split.created._id}/table`, {
    version: 0,
    tableId: table.id,
  }).expect(200);
  const merged = (
    await call('post', `orders/${order.id}/merge`, {
      version: 1,
      sourceId: split.created._id,
      sourceVersion: 1,
    }).expect(200)
  ).body.data;
  expect((await models.tables.findById(table.id))!.status).toBe('AVAILABLE');
  expect(merged.subtotalMinor).toBe(360);
  expect((await OrderModel.findById(split.created._id))!.status).toBe('CANCELLED');
  expect(await StockMovement.countDocuments()).toBe(1);
  expect((await Ingredient.findById(ingredient._id))!.stock).toBe(97);
  expect(await KitchenTicket.countDocuments()).toBe(0);
  expect(await AuditLog.countDocuments({ action: { $in: ['order.split', 'order.merged'] } })).toBe(
    2,
  );
});
it('serializes concurrent splits and blocks paid, adjusted and preparing orders', async () => {
  const order = await restructuringFixture('OPEN');
  const requests = await Promise.all(
    [1, 1].map(() => call('post', `orders/${order.id}/split`, { version: 0, quantities: [1] })),
  );
  expect(requests.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(await OrderModel.countDocuments()).toBe(2);
  for (const status of ['PREPARING', 'COMPLETED']) {
    const locked = await restructuringFixture(status);
    await call('post', `orders/${locked.id}/split`, { version: 0, quantities: [1] }).expect(409);
  }
  const adjusted = await restructuringFixture();
  await OrderModel.updateOne({ _id: adjusted._id }, { $set: { bill: { totalMinor: 360 } } });
  await call('post', `orders/${adjusted.id}/split`, { version: 0, quantities: [1] }).expect(409);
  const paid = await restructuringFixture();
  await Payment.create({
    orderId: paid._id,
    shiftId: new mongoose.Types.ObjectId(),
    actorId: ownerId,
    idempotencyKey: randomUUID(),
    requestHash: 'test',
    method: 'CASH',
    amountMinor: 1,
    tenderedMinor: 1,
    changeMinor: 0,
  });
  await call('post', `orders/${paid.id}/split`, { version: 0, quantities: [1] }).expect(409);
});
it('queues immutable print snapshots idempotently and protects lease transitions', async () => {
  const order = await restructuringFixture();
  const body = { orderId: order.id, kind: 'RECEIPT', width: 58, requestKey: randomUUID() };
  await call('post', 'printing', body, kitchenToken).expect(403);
  await call('get', 'printing', undefined, waiterToken).expect(403);
  const job = (await call('post', 'printing', body).expect(201)).body.data;
  expect((await call('post', 'printing', body).expect(201)).body.data._id).toBe(job._id);
  await call('post', 'printing', { ...body, width: 80 }).expect(409);
  await OrderModel.updateOne({ _id: order._id }, { $set: { 'lines.0.name': 'Changed later' } });
  const list = (await call('get', 'printing').expect(200)).body.data;
  expect(list[0].content.join(' ')).toContain('Snapshot dish');
  expect(list[0].content.join(' ')).not.toContain('Changed later');
  const claims = await Promise.all(
    [1, 1].map(() => call('post', `printing/${job._id}/claim`, { version: 0 })),
  );
  expect(claims.map((r) => r.status).sort()).toEqual([200, 409]);
  const claimed = claims.find((r) => r.status === 200)!.body.data;
  expect((await call('get', 'printing').expect(200)).body.data[0].leaseToken).toBeUndefined();
  await call('post', `printing/${job._id}/finish`, {
    leaseToken: randomUUID(),
    status: 'DIALOG_OPENED',
  }).expect(409);
  const finished = (
    await call('post', `printing/${job._id}/finish`, {
      leaseToken: claimed.leaseToken,
      status: 'DIALOG_OPENED',
    }).expect(200)
  ).body.data;
  const confirmed = (
    await call('post', `printing/${job._id}/confirm`, { version: finished.version }).expect(200)
  ).body.data;
  const retried = (
    await call('post', `printing/${job._id}/retry`, { version: confirmed.version }).expect(200)
  ).body.data;
  const again = (
    await call('post', `printing/${job._id}/claim`, { version: retried.version }).expect(200)
  ).body.data;
  expect(again.attempts).toBe(2);
  await call('post', `printing/${job._id}/retry`, { version: again.version }).expect(409);
  await PrintJob.updateOne({ _id: job._id }, { $set: { leaseUntil: new Date(0) } });
  await call('post', `printing/${job._id}/retry`, { version: again.version }).expect(200);
  await call('post', `printing/${job._id}/finish`, {
    leaseToken: again.leaseToken,
    status: 'DIALOG_OPENED',
  }).expect(409);
});
