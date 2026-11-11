import mongoose, { Schema } from 'mongoose';
const schema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, required: true, unique: true },
    tableName: { type: String, default: 'Takeaway' },
    status: {
      type: String,
      enum: ['SUBMITTED', 'PREPARING', 'READY', 'SERVED', 'VOIDED'],
      required: true,
    },
    version: { type: Number, default: 0 },
    lines: { type: [Schema.Types.Mixed], required: true },
  },
  { timestamps: true, versionKey: false },
);
schema.index({ status: 1, createdAt: 1 });
export const KitchenTicket = mongoose.model('KitchenTicket', schema);
