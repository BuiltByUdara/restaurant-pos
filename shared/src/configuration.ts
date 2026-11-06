import { z } from 'zod';

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Choose a valid record.');
const name = z.string().trim().min(1, 'Enter a name.').max(80);
const description = z.string().trim().max(500).default('');
export const minorUnitsSchema = z.number().int().min(0).max(100_000_000);
export const versionSchema = z.number().int().min(0);
export const categorySchema = z
  .object({ name, description, sortOrder: z.number().int().min(0).max(9999).default(0) })
  .strict();
export const modifierGroupSchema = z
  .object({
    name,
    minSelections: z.number().int().min(0).max(30),
    maxSelections: z.number().int().min(1).max(30),
    options: z
      .array(z.object({ id: z.string().uuid(), name, priceMinor: minorUnitsSchema }).strict())
      .min(1)
      .max(30),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.minSelections > value.maxSelections || value.maxSelections > value.options.length)
      ctx.addIssue({
        code: 'custom',
        path: ['maxSelections'],
        message: 'Selection limits must fit the number of options.',
      });
    if (
      new Set(value.options.map((o) => o.id)).size !== value.options.length ||
      new Set(value.options.map((o) => o.name.toLowerCase())).size !== value.options.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Option names and IDs must be unique.',
      });
  });
export const menuItemSchema = z
  .object({
    name,
    description,
    categoryId: objectIdSchema,
    priceMinor: minorUnitsSchema,
    imageUrl: z
      .union([
        z.literal(''),
        z
          .string()
          .url()
          .max(2048)
          .refine((url) => new URL(url).protocol === 'https:', 'Use an HTTPS image URL.'),
      ])
      .default(''),
    available: z.boolean().default(true),
    station: z.string().trim().min(1).max(50).default('Kitchen'),
    modifierGroupIds: z
      .array(objectIdSchema)
      .max(12)
      .default([])
      .refine(
        (ids) => new Set(ids).size === ids.length,
        'Duplicate modifier groups are not allowed.',
      ),
  })
  .strict();
export const floorSchema = z
  .object({ name, description, sortOrder: z.number().int().min(0).max(9999).default(0) })
  .strict();
export const tableSchema = z
  .object({
    name,
    floorId: objectIdSchema,
    capacity: z.number().int().min(1).max(30),
    x: z.number().int().min(0).max(7),
    y: z.number().int().min(0).max(5),
    shape: z.enum(['square', 'round']).default('square'),
  })
  .strict();
export const tableStatuses = ['AVAILABLE', 'RESERVED', 'OCCUPIED'] as const;
export type TableStatus = (typeof tableStatuses)[number];
export const tableStatusSchema = z
  .object({ status: z.enum(tableStatuses), version: versionSchema })
  .strict();
export const versionBodySchema = z.object({ version: versionSchema }).strict();
export const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(80).default(''),
    sort: z.enum(['name', 'newest']).default('name'),
    categoryId: objectIdSchema.optional(),
    floorId: objectIdSchema.optional(),
    available: z.enum(['true', 'false']).optional(),
  })
  .strict();
export type ConfigurationKind =
  'categories' | 'modifier-groups' | 'menu-items' | 'floors' | 'tables';
export interface RecordBase {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export type Category = RecordBase & z.output<typeof categorySchema>;
export type ModifierGroup = RecordBase & z.output<typeof modifierGroupSchema>;
export type MenuItem = RecordBase & z.output<typeof menuItemSchema>;
export type Floor = RecordBase & z.output<typeof floorSchema>;
export type DiningTable = RecordBase & z.output<typeof tableSchema> & { status: TableStatus };
export interface Page<T> {
  items: T[];
  pagination: { page: number; limit: number; total: number };
}
export interface ConfigurationChange {
  domain: 'catalog' | 'dining';
  kind: ConfigurationKind;
  id: string;
  version: number;
}
