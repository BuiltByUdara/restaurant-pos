import mongoose, { Schema } from 'mongoose';
const common = {
  name: { type: String, required: true, trim: true, maxlength: 80 },
  nameKey: { type: String, required: true },
  version: { type: Number, default: 0, min: 0 },
  archivedAt: { type: Date, default: null },
};
const options = { timestamps: true, versionKey: false } as const;
const text = { type: String, default: '', maxlength: 500 };
const active = { partialFilterExpression: { archivedAt: null } };
const category = new Schema(
  { ...common, description: text, sortOrder: { type: Number, default: 0, min: 0 } },
  options,
);
category.index({ nameKey: 1 }, { unique: true, ...active });
const modifier = new Schema(
  {
    ...common,
    minSelections: { type: Number, required: true, min: 0 },
    maxSelections: { type: Number, required: true, min: 1 },
    options: [
      new Schema(
        {
          id: { type: String, required: true },
          name: { type: String, required: true },
          priceMinor: { type: Number, required: true, min: 0 },
        },
        { _id: false },
      ),
    ],
  },
  options,
);
modifier.index({ nameKey: 1 }, { unique: true, ...active });
const menu = new Schema(
  {
    ...common,
    description: text,
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    priceMinor: { type: Number, required: true, min: 0, max: 100_000_000 },
    imageUrl: { type: String, default: '' },
    available: { type: Boolean, default: true },
    station: { type: String, default: 'Kitchen' },
    modifierGroupIds: [{ type: Schema.Types.ObjectId, ref: 'ModifierGroup' }],
  },
  options,
);
menu.index({ categoryId: 1, nameKey: 1 }, { unique: true, ...active });
menu.index({ archivedAt: 1, available: 1, name: 1 });
menu.index({ modifierGroupIds: 1 });
const floor = new Schema(
  { ...common, description: text, sortOrder: { type: Number, default: 0, min: 0 } },
  options,
);
floor.index({ nameKey: 1 }, { unique: true, ...active });
const table = new Schema(
  {
    ...common,
    floorId: { type: Schema.Types.ObjectId, ref: 'Floor', required: true },
    capacity: { type: Number, required: true, min: 1, max: 30 },
    x: { type: Number, required: true, min: 0, max: 7 },
    y: { type: Number, required: true, min: 0, max: 5 },
    shape: { type: String, enum: ['square', 'round'], default: 'square' },
    status: { type: String, enum: ['AVAILABLE', 'RESERVED', 'OCCUPIED'], default: 'AVAILABLE' },
  },
  options,
);
table.index({ nameKey: 1 }, { unique: true, ...active });
table.index({ floorId: 1, x: 1, y: 1 }, { unique: true, ...active });
export const CategoryModel = mongoose.model('Category', category);
export const ModifierGroupModel = mongoose.model('ModifierGroup', modifier);
export const MenuItemModel = mongoose.model('MenuItem', menu);
export const FloorModel = mongoose.model('Floor', floor);
export const TableModel = mongoose.model('Table', table);
// Low-volume configuration writes share a gate so create/archive reference checks
// cannot write-skew across documents. Order/payment writes will not use this gate.
export const ConfigurationRevision = mongoose.model(
  'ConfigurationRevision',
  new Schema({ _id: String, revision: { type: Number, default: 0 } }, { versionKey: false }),
);
export async function initializeConfiguration() {
  await Promise.all([
    CategoryModel.init(),
    ModifierGroupModel.init(),
    MenuItemModel.init(),
    FloorModel.init(),
    TableModel.init(),
    ConfigurationRevision.init(),
  ]);
  await ConfigurationRevision.updateOne(
    { _id: 'phase2' },
    { $setOnInsert: { revision: 0 } },
    { upsert: true },
  );
}
