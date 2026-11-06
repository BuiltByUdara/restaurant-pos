import type { RequestHandler } from 'express';
import type { EventEmitter } from 'node:events';
import { objectIdSchema, versionBodySchema, type ConfigurationKind } from '@restaurant/shared';
import { listRecords, getRecord, changeRecord } from './service.js';
export function configurationController(kind: ConfigurationKind, events: EventEmitter) {
  const list: RequestHandler = async (req, res) => {
    res.json({ data: await listRecords(kind, req.query) });
  };
  const get: RequestHandler = async (req, res) => {
    res.json({ data: await getRecord(kind, objectIdSchema.parse(req.params.id)) });
  };
  const mutate =
    (action: 'create' | 'update' | 'archive' | 'status'): RequestHandler =>
    async (req, res) => {
      const id = action === 'create' ? undefined : objectIdSchema.parse(req.params.id);
      const input = action === 'archive' ? versionBodySchema.parse(req.body) : req.body;
      const result = await changeRecord(kind, action, input, req.auth!.user.id, String(req.id), id);
      events.emit('configuration:changed', result!.event);
      res.status(action === 'create' ? 201 : 200).json({ data: result!.data });
    };
  return {
    list,
    get,
    create: mutate('create'),
    update: mutate('update'),
    archive: mutate('archive'),
    status: mutate('status'),
  };
}
