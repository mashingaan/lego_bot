import { AsyncLocalStorage } from 'async_hooks';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

const requestIdStorage = new AsyncLocalStorage<{ requestId: string }>();

export function getRequestId(): string | undefined {
  return requestIdStorage.getStore()?.requestId;
}

export function requestIdMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestId = randomUUID();
    (req as any).id = requestId;
    res.setHeader('X-Request-ID', requestId);

    requestIdStorage.run({ requestId }, () => {
      next();
    });
  };
}

export { requestIdStorage };
