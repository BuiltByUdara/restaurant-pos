import { Server } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import type { Config } from './config.js';
import type { AuthService } from './modules/auth/service.js';
import type { EventEmitter } from 'node:events';
import type { ConfigurationChange } from '@restaurant/shared';
export function attachRealtime(
  http: HttpServer,
  auth: AuthService,
  config: Config,
  events?: EventEmitter,
) {
  const io = new Server(http, {
    cors: { origin: config.CLIENT_ORIGIN, credentials: true },
    allowRequest: (req, callback) =>
      callback(null, !req.headers.origin || req.headers.origin === config.CLIENT_ORIGIN),
  });
  io.use(async (socket, next) => {
    try {
      socket.data.identity = await auth.authenticate(String(socket.handshake.auth.token || ''));
      next();
    } catch {
      next(new Error('Authentication required'));
    }
  });
  io.on('connection', (socket) => {
    socket.join(`staff:${socket.data.identity.user.id}`);
    socket.emit('session:ready', { userId: socket.data.identity.user.id });
    // No client-command events exist in Phase 1. Reauthenticate every packet.
    socket.use(async (_packet, next) => {
      try {
        await auth.authenticate(String(socket.handshake.auth.token));
        next();
      } catch {
        socket.disconnect(true);
      }
    });
    const timer = setInterval(async () => {
      try {
        await auth.authenticate(String(socket.handshake.auth.token));
      } catch {
        socket.disconnect(true);
      }
    }, 15_000);
    socket.on('disconnect', () => clearInterval(timer));
  });
  const publish = (event: ConfigurationChange) => {
    for (const socket of io.sockets.sockets.values()) {
      void auth
        .authenticate(String(socket.handshake.auth.token))
        .then((identity) => {
          const permission = event.domain === 'catalog' ? 'menu:read' : 'tables:read';
          if (identity.user.permissions.includes(permission))
            socket.emit(event.domain === 'catalog' ? 'catalog:changed' : 'tables:changed', event);
        })
        .catch(() => socket.disconnect(true));
    }
  };
  events?.on('configuration:changed', publish);
  http.once('close', () => events?.off('configuration:changed', publish));
  return io;
}
