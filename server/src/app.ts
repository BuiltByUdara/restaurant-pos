import express from 'express';
import { printingRoutes } from './modules/printing/routes.js';
import { reportingRoutes } from './modules/reporting/routes.js';
import { inventoryRoutes } from './modules/inventory/routes.js';
import { billingRoutes } from './modules/billing/routes.js';
import { kitchenRoutes } from './modules/kitchen/routes.js';
import { orderRoutes } from './modules/orders/routes.js';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { databaseReady } from './lib/readiness.js';
import { EventEmitter } from 'node:events';
import { configurationRoutes } from './modules/configuration/routes.js';
import type { Config } from './config.js';
import { createAuthService } from './modules/auth/service.js';
import { authRoutes } from './modules/auth/routes.js';
import { staffRoutes } from './modules/staff/routes.js';
import { errorHandler, AppError } from './lib/errors.js';

export function createApp(config: Config, lifecycle = { stopping: false }) {
  const app = express(),
    auth = createAuthService(config);
  const events = new EventEmitter();
  app.disable('x-powered-by');
  if (config.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.use(
    pinoHttp({
      level: config.LOG_LEVEL,
      genReqId: () => randomUUID(),
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: config.CLIENT_ORIGIN, credentials: true }));
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      ((req.headers.origin && req.headers.origin !== config.CLIENT_ORIGIN) ||
        req.headers['sec-fetch-site'] === 'cross-site')
    )
      throw new AppError(403, 'ORIGIN_REJECTED', 'Request origin is not allowed.');
    next();
  });
  app.use(express.json({ limit: '16kb' }), cookieParser());
  app.get('/api/v1/live', (_req, res) => res.json({ data: { status: 'alive' } }));
  app.get('/api/v1/health', async (_req, res) => {
    const ready = !lifecycle.stopping && (await databaseReady());
    res.status(ready ? 200 : 503).json({
      data: {
        status: ready ? 'ok' : 'unavailable',
        database: ready ? 'connected' : 'unavailable',
        phase: 9,
      },
    });
  });
  app.use((_req, _res, next) => {
    if (lifecycle.stopping)
      throw new AppError(503, 'SHUTTING_DOWN', 'Server is restarting. Please retry shortly.');
    next();
  });
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: config.API_RATE_LIMIT_PER_MINUTE,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMIT', message: 'Too many requests. Try again shortly.' } },
    }),
  );
  app.use('/api/v1/auth', authRoutes(auth, config));
  app.use('/api/v1/printing', printingRoutes(auth));
  app.use('/api/v1/staff', staffRoutes(auth));
  app.use('/api/v1/orders', orderRoutes(auth, events));
  app.use('/api/v1/kitchen', kitchenRoutes(auth, events));
  app.use('/api/v1/billing', billingRoutes(auth, events));
  app.use('/api/v1/inventory', inventoryRoutes(auth, events));
  app.use('/api/v1/reporting', reportingRoutes(auth));
  app.use('/api/v1/catalog', configurationRoutes(auth, events, 'catalog'));
  app.use('/api/v1/dining', configurationRoutes(auth, events, 'dining'));
  app.use((_req, _res) => {
    throw new AppError(404, 'NOT_FOUND', 'Endpoint not found.');
  });
  app.use(errorHandler);
  return { app, auth, events };
}
