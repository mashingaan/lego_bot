import type { NextFunction, Request, Response } from 'express';
import type { ZodSchema } from 'zod';

type RequestSource = 'body' | 'query' | 'params';

export function validateRequest(schema: ZodSchema, source: RequestSource) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const logger = (req as any).log;
      logger?.warn?.(
        { source, errors: result.error.issues },
        'Validation failed'
      );
      return res.status(400).json({
        error: 'Validation error',
        details: result.error.issues,
      });
    }

    (req as any)[source] = result.data;
    return next();
  };
}

export function validateBody(schema: ZodSchema) {
  return validateRequest(schema, 'body');
}

export function validateQuery(schema: ZodSchema) {
  return validateRequest(schema, 'query');
}

export function validateParams(schema: ZodSchema) {
  return validateRequest(schema, 'params');
}
