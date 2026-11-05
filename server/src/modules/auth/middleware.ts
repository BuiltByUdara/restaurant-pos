import type { RequestHandler } from 'express';
import type { StaffUser, Permission } from '@restaurant/shared';
import type { AuthService } from './service.js';
import { AppError } from '../../lib/errors.js';
declare global {
  namespace Express {
    interface Request {
      auth?: { user: StaffUser; sessionId: string };
    }
  }
}
export function requireAuth(auth: AuthService): RequestHandler {
  return async (req, _res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer '))
      throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in.');
    req.auth = await auth.authenticate(header.slice(7));
    next();
  };
}
export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth?.user.permissions.includes(permission))
      throw new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
    next();
  };
}
