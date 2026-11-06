import mongoose from 'mongoose';
import type { ClientSession } from 'mongoose';
import {
  categorySchema,
  modifierGroupSchema,
  menuItemSchema,
  floorSchema,
  tableSchema,
  versionSchema,
  listSchema,
  tableStatusSchema,
  type ConfigurationKind,
  type ConfigurationChange,
} from '@restaurant/shared';
import { AppError } from '../../lib/errors.js';
import { AuditLog } from '../auth/models.js';
import { ConfigurationRevision } from './models.js';
import { models, findActive, toDto } from './repository.js';

const schemas = {
  categories: categorySchema,
  'modifier-groups': modifierGroupSchema,
  'menu-items': menuItemSchema,
  floors: floorSchema,
  tables: tableSchema,
};
const conflict = () =>
  new AppError(
    409,
    'VERSION_CONFLICT',
    'This record changed on another device. Close the editor and reload it before saving.',
  );
const notFound = () => new AppError(404, 'NOT_FOUND', 'This record no longer exists.');
function validatePayload(kind: ConfigurationKind, input: unknown, editing: boolean) {
  let version: number | undefined;
  let payload = input;
  if (editing) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request body.');
    const { version: expected, ...rest } = input as Record<string, unknown>;
    version = versionSchema.parse(expected);
    payload = rest;
  }
  return { version, fields: schemas[kind].parse(payload) };
}
export async function listRecords(kind: ConfigurationKind, query: unknown) {
  const q = listSchema.parse(query);
  const filter: Record<string, unknown> = { archivedAt: null };
  if (q.search)
    filter.name = { $regex: q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  if (q.categoryId && kind === 'menu-items') filter.categoryId = q.categoryId;
  if (q.floorId && kind === 'tables') filter.floorId = q.floorId;
  if (q.available && kind === 'menu-items') filter.available = q.available === 'true';
  const sort: Record<string, 1 | -1> =
    q.sort === 'newest'
      ? { createdAt: -1, _id: 1 }
      : kind === 'categories' || kind === 'floors'
        ? { sortOrder: 1, name: 1, _id: 1 }
        : { name: 1, _id: 1 };
  const [records, total] = await Promise.all([
    models[kind]
      .find(filter)
      .sort(sort)
      .skip((q.page - 1) * q.limit)
      .limit(q.limit),
    models[kind].countDocuments(filter),
  ]);
  return { items: records.map(toDto), pagination: { page: q.page, limit: q.limit, total } };
}
export async function getRecord(kind: ConfigurationKind, id: string) {
  const record = await findActive(kind, id);
  if (!record) throw notFound();
  return toDto(record);
}

async function requireReferences(
  kind: ConfigurationKind,
  fields: Record<string, unknown>,
  session: ClientSession,
) {
  if (kind === 'menu-items') {
    if (!(await findActive('categories', String(fields.categoryId), session)))
      throw new AppError(409, 'REFERENCE_UNAVAILABLE', 'Choose an active category.');
    for (const id of fields.modifierGroupIds as string[]) {
      if (!(await findActive('modifier-groups', id, session)))
        throw new AppError(409, 'REFERENCE_UNAVAILABLE', 'A selected modifier group was archived.');
    }
  }
  if (kind === 'tables' && !(await findActive('floors', String(fields.floorId), session)))
    throw new AppError(409, 'REFERENCE_UNAVAILABLE', 'Choose an active floor.');
}
async function assertArchivable(
  kind: ConfigurationKind,
  id: string,
  status: unknown,
  session: ClientSession,
) {
  const ref =
    kind === 'categories'
      ? { categoryId: id }
      : kind === 'modifier-groups'
        ? { modifierGroupIds: id }
        : null;
  if (ref && (await models['menu-items'].exists({ ...ref, archivedAt: null }).session(session)))
    throw new AppError(
      409,
      'IN_USE',
      'This record is used by active menu items. Reassign or archive those items first.',
    );
  if (
    kind === 'floors' &&
    (await models.tables.exists({ floorId: id, archivedAt: null }).session(session))
  )
    throw new AppError(409, 'IN_USE', 'Move or archive this floor’s tables first.');
  if (kind === 'tables' && status !== 'AVAILABLE')
    throw new AppError(409, 'TABLE_BUSY', 'Only available tables can be archived.');
}
export async function changeRecord(
  kind: ConfigurationKind,
  action: 'create' | 'update' | 'archive' | 'status',
  input: unknown,
  actor: string,
  requestId: string,
  id?: string,
) {
  let expected: number | undefined;
  let fields: Record<string, unknown> = {};
  if (action === 'archive') {
    expected = versionSchema.parse((input as { version?: unknown })?.version);
  } else if (action === 'status') {
    const parsed = tableStatusSchema.parse(input);
    expected = parsed.version;
    fields = { status: parsed.status };
  } else {
    const parsed = validatePayload(kind, input, action === 'update');
    expected = parsed.version;
    fields = parsed.fields;
  }
  // Ensure the gate exists before opening the transaction; never create collections
  // or rely on transaction retries to resolve duplicate singleton creation.
  await ConfigurationRevision.updateOne(
    { _id: 'phase2' },
    { $setOnInsert: { revision: 0 } },
    { upsert: true },
  );
  try {
    const result = await mongoose.connection.transaction(async (session) => {
      await ConfigurationRevision.updateOne(
        { _id: 'phase2' },
        { $inc: { revision: 1 } },
        { session },
      );
      let record;
      if (action === 'create') {
        await requireReferences(kind, fields, session);
        [record] = await models[kind].create(
          [{ ...fields, nameKey: String(fields.name).normalize('NFKC').toLowerCase(), version: 0 }],
          { session },
        );
      } else {
        const current = await findActive(kind, id!, session);
        if (!current) throw notFound();
        if (current.version !== expected) throw conflict();
        if (action === 'archive') {
          await assertArchivable(kind, id!, current.status, session);
          fields = { archivedAt: new Date() };
        } else if (action === 'status') {
          const allowed: Record<string, string[]> = {
            AVAILABLE: ['RESERVED', 'OCCUPIED'],
            RESERVED: ['AVAILABLE', 'OCCUPIED'],
            OCCUPIED: ['AVAILABLE'],
          };
          if (!allowed[String(current.status)]?.includes(String(fields.status)))
            throw new AppError(
              409,
              'INVALID_TRANSITION',
              'That table status transition is not allowed.',
            );
        } else {
          if (kind === 'tables' && current.status !== 'AVAILABLE')
            throw new AppError(
              409,
              'TABLE_BUSY',
              'Make this table available before changing its layout or capacity.',
            );
          await requireReferences(kind, fields, session);
          fields = { ...fields, nameKey: String(fields.name).normalize('NFKC').toLowerCase() };
        }
        record = await models[kind].findOneAndUpdate(
          { _id: id, version: expected, archivedAt: null },
          { $set: fields, $inc: { version: 1 } },
          { new: true, runValidators: true, session },
        );
        if (!record) throw conflict();
      }
      await AuditLog.create(
        [{ actor, action: `${kind}.${action}`, entityId: String(record._id), requestId }],
        { session },
      );
      const data = toDto(record);
      const event: ConfigurationChange = {
        domain: kind === 'floors' || kind === 'tables' ? 'dining' : 'catalog',
        kind,
        id: data.id,
        version: record.version,
      };
      return { data, event };
    });
    return result;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000)
      throw new AppError(
        409,
        'DUPLICATE_RECORD',
        'That name or floor-plan position is already in use.',
      );
    throw error;
  }
}
