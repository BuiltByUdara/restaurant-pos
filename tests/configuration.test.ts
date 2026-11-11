import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
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
