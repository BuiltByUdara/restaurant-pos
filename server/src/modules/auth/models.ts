import mongoose, { Schema } from 'mongoose';
import { permissions, roleNames } from '@restaurant/shared';

const roleSchema = new Schema(
  {
    name: { type: String, enum: roleNames, required: true, unique: true },
    permissions: [{ type: String, enum: permissions, required: true }],
  },
  { timestamps: true },
);
const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    passwordHash: { type: String, required: true, select: false },
    pinHash: { type: String, select: false },
    role: { type: Schema.Types.ObjectId, ref: 'Role', required: true },
    active: { type: Boolean, default: true },
    lastLoginAt: Date,
  },
  { timestamps: true, optimisticConcurrency: true },
);
const sessionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    currentHash: { type: String, required: true, select: false },
    usedHashes: { type: [String], default: [], select: false },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    lastUsedAt: Date,
  },
  { timestamps: true },
);
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const auditSchema = new Schema(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true },
    entityId: String,
    requestId: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditSchema.index({ createdAt: -1 });
export const Role = mongoose.model('Role', roleSchema);
export const User = mongoose.model('User', userSchema);
export const Session = mongoose.model('Session', sessionSchema);
export const AuditLog = mongoose.model('AuditLog', auditSchema);
