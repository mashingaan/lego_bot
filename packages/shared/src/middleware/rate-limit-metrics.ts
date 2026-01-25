import type { Logger } from '../logger';

export function logRateLimitMetrics(logger: Logger) {
  return (req: any, res: any, next: any) => {
    const rateLimitInfo = {
      limit: res.getHeader('X-RateLimit-Limit'),
      remaining: res.getHeader('X-RateLimit-Remaining'),
      reset: res.getHeader('X-RateLimit-Reset'),
    };
    
    if (rateLimitInfo.remaining !== undefined) {
      logger.debug(
        { 
          requestId: req.id,
          path: req.path,
          rateLimit: rateLimitInfo,
        },
        'Rate limit status'
      );
    }
    
    next();
  };
}
