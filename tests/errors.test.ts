import { expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { errorHandler } from '../server/src/lib/errors';
it('preserves the original exception for completion logs without exposing it to clients', () => {
  const original = new Error('Database diagnostic');
  const json = vi.fn();
  const response = { status: vi.fn().mockReturnThis(), json };
  errorHandler(original, { id: 'test-request', log: { error: vi.fn() } } as unknown as Request, response as unknown as Response, vi.fn() as NextFunction);
  expect((response as typeof response & { err: Error }).err).toBe(original);
  expect(response.status).toHaveBeenCalledWith(500);
  expect(JSON.stringify(json.mock.calls)).not.toContain('Database diagnostic');
});
