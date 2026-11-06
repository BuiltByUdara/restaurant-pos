import { randomUUID } from 'node:crypto';
import { models } from './repository.js';
import { changeRecord } from './service.js';
import { initializeConfiguration } from './models.js';
import type { ConfigurationKind } from '@restaurant/shared';
export async function seedDemoCatalog(actor: string) {
  await initializeConfiguration();
  async function ensure(kind: ConfigurationKind, name: string, fields: Record<string, unknown>) {
    const existing = await models[kind].findOne({ nameKey: name.toLowerCase(), archivedAt: null });
    if (existing) return String(existing._id);
    return (await changeRecord(kind, 'create', { name, ...fields }, actor, 'demo-seed'))!.data.id;
  }
  const mains = await ensure('categories', 'Mains', {
    description: 'Fresh from the kitchen',
    sortOrder: 0,
  });
  const drinks = await ensure('categories', 'Drinks', {
    description: 'Coffee and refreshing favorites',
    sortOrder: 1,
  });
  const sides = await ensure('categories', 'Sides', {
    description: 'A little something extra',
    sortOrder: 2,
  });
  const extras = await ensure('modifier-groups', 'Burger extras', {
    minSelections: 0,
    maxSelections: 2,
    options: [
      { id: randomUUID(), name: 'Extra cheese', priceMinor: 20000 },
      { id: randomUUID(), name: 'Avocado', priceMinor: 30000 },
    ],
  });
  const milk = await ensure('modifier-groups', 'Milk choice', {
    minSelections: 1,
    maxSelections: 1,
    options: [
      { id: randomUUID(), name: 'Dairy milk', priceMinor: 0 },
      { id: randomUUID(), name: 'Oat milk', priceMinor: 15000 },
    ],
  });
  for (const item of [
    {
      name: 'House beef burger',
      categoryId: mains,
      priceMinor: 185000,
      description: 'Grilled beef, aged cheddar, pickles and house sauce.',
      modifierGroupIds: [extras],
    },
    {
      name: 'Roasted vegetable bowl',
      categoryId: mains,
      priceMinor: 145000,
      description: 'Seasonal vegetables, brown rice and lemon dressing.',
    },
    {
      name: 'Grilled chicken plate',
      categoryId: mains,
      priceMinor: 195000,
      description: 'Herb chicken with greens and roasted potatoes.',
    },
    {
      name: 'Iced latte',
      categoryId: drinks,
      priceMinor: 75000,
      description: 'Double espresso over ice with your choice of milk.',
      modifierGroupIds: [milk],
      station: 'Bar',
    },
    {
      name: 'Fresh lime soda',
      categoryId: drinks,
      priceMinor: 55000,
      description: 'Fresh lime, soda and a hint of sweetness.',
      station: 'Bar',
    },
    {
      name: 'Crispy fries',
      categoryId: sides,
      priceMinor: 65000,
      description: 'Golden fries with sea salt and house dip.',
    },
  ]) {
    const { name, ...fields } = item;
    await ensure('menu-items', name, fields);
  }
  const floorId = await ensure('floors', 'Main dining', {
    description: 'The heart of the restaurant',
    sortOrder: 0,
  });
  for (let i = 0; i < 6; i++) {
    const x = (i % 3) * 2,
      y = Math.floor(i / 3) * 2;
    if (await models.tables.exists({ floorId, x, y, archivedAt: null })) continue;
    await ensure('tables', `T${String(i + 1).padStart(2, '0')}`, {
      floorId,
      capacity: i < 3 ? 2 : 4,
      x,
      y,
      shape: i < 3 ? 'round' : 'square',
    });
  }
}
