import type { NextFunction, Request, Response } from 'express';

export function requireBotOwnership(botIdParam: string = 'id') {
  return async (req: Request, res: Response, next: NextFunction) => {
    const botId = req.params[botIdParam];
    const userId = (req as any).user?.id;
    const getBotById = (req.app.locals as any).getBotById as
      | ((id: string, userId: number) => Promise<any>)
      | undefined;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!botId || typeof getBotById !== 'function') {
      const logger = (req as any).log;
      logger?.error?.({ botId }, 'Bot ownership check failed');
      return res.status(500).json({ error: 'Internal server error' });
    }

    const bot = await getBotById(botId, userId);
    if (!bot) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    (req as any).bot = bot;
    return next();
  };
}
