import type { Model, ClientSession } from 'mongoose';
import type { ConfigurationKind } from '@restaurant/shared';
import {
  CategoryModel,
  ModifierGroupModel,
  MenuItemModel,
  FloorModel,
  TableModel,
} from './models.js';

// Common document fields used by the configuration service. Individual schemas
// retain validation and indexes; shared Zod schemas validate the full payload.
export interface ConfigurationDocument {
  _id: unknown;
  name: string;
  nameKey: string;
  version: number;
  archivedAt: Date | null;
  status?: string;
  categoryId?: unknown;
  modifierGroupIds?: unknown[];
  floorId?: unknown;
  [key: string]: unknown;
}
export const models: Record<ConfigurationKind, Model<ConfigurationDocument>> = {
  categories: CategoryModel,
  'modifier-groups': ModifierGroupModel,
  'menu-items': MenuItemModel,
  floors: FloorModel,
  tables: TableModel,
} as unknown as Record<ConfigurationKind, Model<ConfigurationDocument>>;
export function findActive(kind: ConfigurationKind, id: string, session?: ClientSession) {
  return models[kind].findOne({ _id: id, archivedAt: null }).session(session ?? null);
}
export function toDto(document: { toObject: () => Record<string, unknown> }) {
  const raw = document.toObject();
  const { _id, nameKey, archivedAt, ...fields } = raw;
  return { ...fields, id: String(_id) };
}
