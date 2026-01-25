import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import type { RedisClientType } from 'redis';
import type { Logger } from '../logger';
import { RATE_LIMITS } from '../constants/limits';

export function createRateLimiter(
  redisClient: RedisClientType | null,
  logger: Logger,
  config: {
    windowMs: number;
    max: number;
    keyGenerator?: (req: any) => string;
    skipSuccessfulRequests?: boolean;
  }
) {
  const store = redisClient
    ? new RedisStore({
        sendCommand: (...args: string[]) => redisClient.sendCommand(args),
        prefix: 'rl:',
      })
    : undefined;

  if (!store) {
    logger.warn('Redis unavailable, using in-memory rate limiting');
  }

  return rateLimit({
    windowMs: config.windowMs,
    max: config.max,
    standardHeaders: true,
    legacyHeaders: false,
    store,
    keyGenerator: config.keyGenerator || ((req) => {
      const userId = (req as any).user?.id || (req as any).query?.userId || 'anonymous';
      return `${userId}`;
    }),
    skipSuccessfulRequests: config.skipSuccessfulRequests || false,
    handler: (req, res) => {
      const requestId = (req as any).id;
      logger.warn(
        { requestId, userId: (req as any).user?.id, path: req.path },
        'Rate limit exceeded'
      );
      res.status(429).json({
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: res.getHeader('Retry-After'),
      });
    },
  });
}
