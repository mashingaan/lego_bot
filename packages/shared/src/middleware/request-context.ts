import type { NextFunction, Request, Response } from 'express';

export function requestContextMiddleware() {
  return (req: Request, _res: Response, next: NextFunction) => {
    (req as any).context = {
      requestId: (req as any).id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    };

    next();
  };
}
