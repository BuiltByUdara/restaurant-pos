import { Router } from 'express';
import type { EventEmitter } from 'node:events';
import type { ConfigurationKind, Permission } from '@restaurant/shared';
import type { AuthService } from '../auth/service.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { configurationController } from './controller.js';
export function configurationRoutes(
  auth: AuthService,
  events: EventEmitter,
  domain: 'catalog' | 'dining',
) {
  const router = Router();
  router.use(requireAuth(auth));
  const kinds: ConfigurationKind[] =
    domain === 'catalog' ? ['categories', 'modifier-groups', 'menu-items'] : ['floors', 'tables'];
  const read: Permission = domain === 'catalog' ? 'menu:read' : 'tables:read';
  const write: Permission = domain === 'catalog' ? 'menu:write' : 'tables:write';
  for (const kind of kinds) {
    const c = configurationController(kind, events),
      base = `/${kind}`;
    router.get(base, requirePermission(read), c.list);
    router.get(`${base}/:id`, requirePermission(read), c.get);
    router.post(base, requirePermission(write), c.create);
    router.put(`${base}/:id`, requirePermission(write), c.update);
    router.delete(`${base}/:id`, requirePermission(write), c.archive);
    if (kind === 'tables')
      router.patch(`${base}/:id/status`, requirePermission('tables:operate'), c.status);
  }
  return router;
}
