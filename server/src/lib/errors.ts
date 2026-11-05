import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Check the submitted fields.',
        requestId: req.id,
      },
    });
    return;
  }
  if (error instanceof AppError) {
    res
      .status(error.status)
      .json({ error: { code: error.code, message: error.message, requestId: req.id } });
    return;
  }
  if (error.status === 400 || error.status === 413) {
    res
      .status(error.status)
      .json({ error: { code: 'INVALID_BODY', message: 'Invalid or oversized request body.' } });
    return;
  }
  req.log.error({ err: error }, 'Request failed');
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
      requestId: req.id,
    },
  });
};
