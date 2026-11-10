import { createServer } from 'node:http';
import mongoose from 'mongoose';
import pino from 'pino';
import { readConfig } from './config.js';
import { connectDatabase } from './db.js';
import { createApp } from './app.js';
import { attachRealtime } from './realtime.js';
import { initializeConfiguration } from './modules/configuration/models.js';
import { OrderModel } from './modules/orders/model.js';
const config = readConfig(),
  logger = pino({ level: config.LOG_LEVEL });
try {
  await connectDatabase(config.MONGODB_URI);
  await initializeConfiguration();
  await OrderModel.init();
  const { app, auth, events } = createApp(config);
  const http = createServer(app);
  const io = attachRealtime(http, auth, config, events);
  http.listen(config.PORT, () => logger.info({ port: config.PORT }, 'POS API ready'));
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    logger.info('Shutting down');
    const deadline = setTimeout(() => process.exit(1), 10000);
    deadline.unref();
    io.close();
    http.close(async () => {
      await mongoose.disconnect();
      clearTimeout(deadline);
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
} catch (error) {
  logger.fatal({ err: error }, 'Startup failed');
  await mongoose.disconnect();
  process.exit(1);
}
