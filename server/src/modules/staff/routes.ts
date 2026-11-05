import { Router } from 'express';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { User, Role } from '../auth/models.js';
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
        name: u.name,
        email: u.email,
        active: u.active,
        role: roles.find((r) => r._id.equals(u.role))?.name,
        lastLoginAt: u.lastLoginAt,
      })),
      pagination: { page: q.page, limit: q.limit, total },
    });
  });
  return router;
}
