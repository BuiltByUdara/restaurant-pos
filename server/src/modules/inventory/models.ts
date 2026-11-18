import mongoose, { Schema } from 'mongoose';
const opts = { timestamps: true, versionKey: false } as const;
export const Ingredient = mongoose.model(
  'Ingredient',
  new Schema(
    {
      name: { type: String, required: true },
      nameKey: { type: String, unique: true, required: true },
      unit: { type: String, enum: ['g', 'ml', 'each'], required: true },
      stock: { type: Number, default: 0 },
      lowStock: { type: Number, default: 0 },
      version: { type: Number, default: 0 },
    },
    opts,
  ),
);
export const Recipe = mongoose.model(
  'Recipe',
  new Schema(
    {
      menuItemId: { type: Schema.Types.ObjectId, unique: true, required: true },
      components: [
        {
          _id: false,
          ingredientId: { type: Schema.Types.ObjectId, required: true },
          quantity: { type: Number, required: true },
        },
      ],
      version: { type: Number, default: 0 },
    },
    opts,
  ),
);
export const StockMovement = mongoose.model(
  'StockMovement',
  new Schema(
    {
      ingredientId: { type: Schema.Types.ObjectId, required: true, index: true },
      delta: { type: Number, required: true },
      kind: { type: String, enum: ['RECEIVE', 'ADJUST', 'WASTE', 'CONSUME'], required: true },
      reason: { type: String, required: true },
      actorId: { type: Schema.Types.ObjectId, required: true },
      orderId: Schema.Types.ObjectId,
      key: { type: String, unique: true, required: true },
    },
    opts,
  ),
);
export const Supplier = mongoose.model(
  'Supplier',
  new Schema(
    { name: { type: String, required: true }, contact: { type: String, default: '' } },
    opts,
  ),
);
export const PurchaseOrder = mongoose.model(
  'PurchaseOrder',
  new Schema(
    {
      supplierId: { type: Schema.Types.ObjectId, required: true },
      status: { type: String, enum: ['OPEN', 'RECEIVED', 'CANCELLED'], default: 'OPEN' },
      version: { type: Number, default: 0 },
      lines: [
        {
          _id: false,
          ingredientId: { type: Schema.Types.ObjectId, required: true },
          quantity: { type: Number, required: true },
        },
      ],
    },
    opts,
  ),
);
export async function initializeInventory() {
  await Promise.all([
    Ingredient.init(),
    Recipe.init(),
    StockMovement.init(),
    Supplier.init(),
    PurchaseOrder.init(),
  ]);
}
