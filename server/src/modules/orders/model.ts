import mongoose, { Schema } from 'mongoose';
import { orderStates } from '@restaurant/shared';
const schema = new Schema(
  {
    status: { type: String, enum: orderStates, default: 'OPEN', required: true },
    version: { type: Number, default: 0 },
    tableId: { type: Schema.Types.ObjectId, default: null },
    customerName: { type: String, default: '' },
    history: { type: [Schema.Types.Mixed], default: [] },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    lines: { type: [Schema.Types.Mixed], required: true },
    subtotalMinor: { type: Number, required: true },
  },
  { timestamps: true, versionKey: false },
);
schema.index({ status: 1, createdAt: -1 });
export const OrderModel = mongoose.model('Order', schema);
