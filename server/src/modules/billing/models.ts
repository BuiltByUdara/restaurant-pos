import mongoose, { Schema } from 'mongoose';
const money = { type: Number, required: true, min: 0, max: 100_000_000 };
const shiftSchema = new Schema(
  {
    cashierId: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: ['OPEN', 'CLOSED'], default: 'OPEN' },
    openingMinor: money,
    version: { type: Number, default: 0 },
    countedMinor: Number,
    expectedMinor: Number,
    differenceMinor: Number,
    closedAt: Date,
  },
  { timestamps: true, versionKey: false },
);
shiftSchema.index({ cashierId: 1 }, { unique: true, partialFilterExpression: { status: 'OPEN' } });
const paymentSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, required: true, index: true },
    shiftId: { type: Schema.Types.ObjectId, required: true, index: true },
    actorId: { type: Schema.Types.ObjectId, required: true },
    idempotencyKey: { type: String, required: true, unique: true },
    requestHash: { type: String, required: true },
    method: { type: String, enum: ['CASH'], required: true },
    amountMinor: money,
    tenderedMinor: money,
    changeMinor: money,
  },
  { timestamps: true, versionKey: false },
);
export const Shift = mongoose.model('Shift', shiftSchema);
export const Payment = mongoose.model('Payment', paymentSchema);
const movementSchema = new Schema(
  {
    shiftId: { type: Schema.Types.ObjectId, required: true, index: true },
    actorId: { type: Schema.Types.ObjectId, required: true },
    orderId: Schema.Types.ObjectId,
    paymentId: Schema.Types.ObjectId,
    kind: { type: String, enum: ['REFUND', 'IN', 'OUT'], required: true },
    amountMinor: money,
    reason: { type: String, required: true },
    idempotencyKey: { type: String, required: true, unique: true },
    requestHash: { type: String, required: true },
  },
  { timestamps: true, versionKey: false },
);
export const CashMovement = mongoose.model('CashMovement', movementSchema);
export const PrintJob = mongoose.model(
  'PrintJob',
  new Schema(
    {
      orderId: { type: Schema.Types.ObjectId, required: true },
      actorId: { type: Schema.Types.ObjectId, required: true },
      status: {
        type: String,
        enum: ['QUEUED', 'PRINTING', 'DIALOG_OPENED', 'CONFIRMED', 'FAILED'],
        default: 'QUEUED',
      },
      width: { type: Number, enum: [58, 80], required: true },
      kind: { type: String, enum: ['RECEIPT', 'KITCHEN'], default: 'RECEIPT' },
      requestKey: { type: String, unique: true, sparse: true },
      content: [String],
      version: { type: Number, default: 0 },
      attempts: { type: Number, default: 0 },
      leaseToken: String,
      leaseUntil: Date,
    },
    { timestamps: true },
  ),
);
export async function initializeBilling() {
  await Promise.all([Shift.init(), Payment.init(), CashMovement.init(), PrintJob.init()]);
}
