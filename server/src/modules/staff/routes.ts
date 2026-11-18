import { Router } from 'express';
import mongoose from 'mongoose';
import { roleNames } from '@restaurant/shared';
import { passwordHash } from '../auth/service.js';
import { ConfigurationRevision } from '../configuration/models.js';
import { AppError } from '../../lib/errors.js';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { User, Role, Session, AuditLog } from '../auth/models.js';
export function staffRoutes(auth: AuthService) {
  const router = Router();
  router.use(requireAuth(auth), requirePermission('staff:read'));
  router.get('/', async (req, res) => {
    const q = z
      .object({
        page: z.coerce.number().int().min(1).max(10000).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      })
      .parse(req.query);
    const [users, total, roles] = await Promise.all([
      User.find()
        .sort({ name: 1, _id: 1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      User.countDocuments(),
      Role.find().lean(),
    ]);
    res.json({
      data: users.map((u) => ({
        id: String(u._id),
        version: u.__v,
        name: u.name,
        email: u.email,
        active: u.active,
        role: roles.find((r) => r._id.equals(u.role))?.name,
        lastLoginAt: u.lastLoginAt,
      })),
      pagination: { page: q.page, limit: q.limit, total },
    });
  });
  const fieldsSchema = z
    .object({
      name: z.string().trim().min(1).max(100),
      email: z
        .string()
        .trim()
        .email()
        .max(254)
        .transform((s) => s.toLowerCase()),
      role: z.enum(roleNames),
      active: z.boolean(),
      password: z.string().min(14).max(128).optional(),
      version: z.number().int().min(0).optional(),
    })
    .strict();
  for (const method of ['post', 'put'] as const)
    router[method](
      method === 'post' ? '/' : '/:id',
      requirePermission('staff:write'),
      async (req, res) => {
        const fields = fieldsSchema.parse(req.body);
        const id =
          method === 'put'
            ? z
                .string()
                .regex(/^[a-f\d]{24}$/i)
                .parse(req.params.id)
            : undefined;
        if (!id && !fields.password)
          throw new AppError(
            400,
            'PASSWORD_REQUIRED',
            'Provide an initial password of at least 14 characters.',
          );
        if (id && fields.version === undefined)
          throw new AppError(400, 'VERSION_REQUIRED', 'Reload the staff record.');
        const hash = fields.password ? await passwordHash(fields.password) : undefined;
        const result = await mongoose.connection.transaction(async (session) => {
          await ConfigurationRevision.updateOne(
            { _id: 'phase2' },
            { $inc: { revision: 1 } },
            { session },
          );
          const target = id ? await User.findById(id).session(session) : null;
          if (id && !target) throw new AppError(404, 'NOT_FOUND', 'Staff member not found.');
          if (target && target.__v !== fields.version)
            throw new AppError(409, 'VERSION_CONFLICT', 'Staff record changed; reload.');
          const role = await Role.findOne({ name: fields.role }).session(session);
          const oldRole = target ? await Role.findById(target.role).session(session) : null;
          if (!role) throw new AppError(400, 'INVALID_ROLE', 'Role not found.');
          if (
            req.auth!.user.role !== 'Owner' &&
            (oldRole?.name === 'Owner' ||
              role.name === 'Owner' ||
              role.permissions.some((p) => !req.auth!.user.permissions.includes(p)))
          )
            throw new AppError(403, 'FORBIDDEN', 'Cannot manage or grant elevated access.');
          if (id === req.auth!.user.id && (!fields.active || fields.role !== req.auth!.user.role))
            throw new AppError(409, 'SELF_LOCKOUT', 'You cannot disable or change your own role.');
          if (
            oldRole?.name === 'Owner' &&
            target?.active &&
            (!fields.active || fields.role !== 'Owner') &&
            (await User.countDocuments({ role: oldRole._id, active: true }).session(session)) <= 1
          )
            throw new AppError(409, 'LAST_OWNER', 'Keep at least one active owner.');
          if (
            await User.exists({ email: fields.email, ...(id ? { _id: { $ne: id } } : {}) }).session(
              session,
            )
          )
            throw new AppError(
              409,
              'DUPLICATE_EMAIL',
              'Email already belongs to another staff member.',
            );
          const user = target || new User();
          user.set({
            name: fields.name,
            email: fields.email,
            role: role._id,
            active: fields.active,
            ...(hash ? { passwordHash: hash } : {}),
          });
          await user.save({ session });
          if (id)
            await Session.updateMany(
              { user: id, revokedAt: null },
              { $set: { revokedAt: new Date() } },
              { session },
            );
          await AuditLog.create(
            [
              {
                actor: req.auth!.user.id,
                action: id ? 'staff.updated' : 'staff.created',
                entityId: user.id,
              },
            ],
            { session },
          );
          return { id: user.id, name: user.name, version: user.__v };
        });
        res.status(id ? 200 : 201).json({ data: result });
      },
    );
  return router;
}
