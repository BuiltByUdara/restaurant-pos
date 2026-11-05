import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import mongoose from 'mongoose';
import type { Config } from './config.js';
import { createAuthService } from './modules/auth/service.js';
import { authRoutes } from './modules/auth/routes.js';
import { staffRoutes } from './modules/staff/routes.js';
import { errorHandler, AppError } from './lib/errors.js';

export function createApp(config: Config) {
  const app = express(),
    auth = createAuthService(config);
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
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: 180,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMIT', message: 'Too many requests. Try again shortly.' } },
    }),
  );
  app.get('/api/v1/health', (_req, res) => {
    const ready = mongoose.connection.readyState === 1;
    res.status(ready ? 200 : 503).json({
      data: {
        status: ready ? 'ok' : 'unavailable',
        database: ready ? 'connected' : 'disconnected',
        phase: 1,
      },
    });
  });
  app.use('/api/v1/auth', authRoutes(auth, config));
  app.use('/api/v1/staff', staffRoutes(auth));
  app.use((_req, _res) => {
    throw new AppError(404, 'NOT_FOUND', 'Endpoint not found.');
  });
  app.use(errorHandler);
  return { app, auth };
}
