import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Config } from '../../config.js';
import type { AuthService } from './service.js';
import { authController } from './controller.js';
import { requireAuth } from './middleware.js';
export function authRoutes(auth: AuthService, config: Config) {
  const router = Router(),
    controller = authController(auth, config);
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      error: { code: 'RATE_LIMIT', message: 'Too many sign-in attempts. Try again in 15 minutes.' },
    },
  });
  router.post('/login', limiter, controller.login);
  router.post('/refresh', controller.refresh);
  router.post('/logout', controller.logout);
  router.get('/me', requireAuth(auth), controller.me);
  return router;
}
