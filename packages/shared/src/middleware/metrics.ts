import type { NextFunction, Request, Response } from 'express';
import type { Logger } from 'pino';
import { getRequestId } from './request-id';

export type MetricsMiddlewareOptions = {
  sampleRate?: number;
};

function parseSize(value: string | number | string[] | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function metricsMiddleware(logger: Logger, options: MetricsMiddlewareOptions = {}) {
  const isProduction = process.env.NODE_ENV === 'production';
  const sampleRateFromEnv = process.env.SAMPLE_RATE;
  const sampleRateCandidate = sampleRateFromEnv ? Number.parseFloat(sampleRateFromEnv) : (isProduction ? 0.1 : 1);
  const sampleRateRaw = options.sampleRate ?? sampleRateCandidate;
  const sampleRate = Number.isFinite(sampleRateRaw)
    ? Math.min(1, Math.max(0, sampleRateRaw))
    : (isProduction ? 0.1 : 1);
  const slowMsFromEnv = process.env.SLOW_THRESHOLD_MS;
  const slowMsCandidate = slowMsFromEnv ? Number.parseInt(slowMsFromEnv, 10) : 500;
  const slowThresholdMs = Number.isFinite(slowMsCandidate) && slowMsCandidate > 0 ? slowMsCandidate : 500;
  const loggerBindings = typeof logger.bindings === 'function' ? logger.bindings() : {};
  const service = (loggerBindings as { service?: string }).service;

  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const requestSize = parseSize(req.headers['content-length']);
      const responseSize = parseSize(res.getHeader('content-length'));
      const requestId = (req as any).id ?? getRequestId();
      const userId = (req as any).user?.id ?? (req as any).userId;
      const payload: Record<string, unknown> = {
        metric: 'http_request',
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration,
        requestSize,
        responseSize,
      };
      if (service) {
        payload.service = service;
      }
      if (requestId) {
        payload.requestId = requestId;
      }
      if (userId !== undefined && userId !== null) {
        payload.userId = userId;
      }

      if (
        res.statusCode >= 500
        || duration >= slowThresholdMs
        || (sampleRate > 0 && Math.random() < sampleRate)
      ) {
        logger.info(payload);
      }
    });

    next();
  };
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  hitRate: number;
}

const cacheMetrics = {
  schema: { hits: 0, misses: 0 },
};

export function recordCacheHit(cacheType: 'schema') {
  cacheMetrics[cacheType].hits++;
}

export function recordCacheMiss(cacheType: 'schema') {
  cacheMetrics[cacheType].misses++;
}

export function getCacheMetrics(): Record<string, CacheMetrics> {
  return Object.entries(cacheMetrics).reduce((acc, [key, value]) => {
    const total = value.hits + value.misses;
    acc[key] = {
      ...value,
      hitRate: total > 0 ? value.hits / total : 0,
    };
    return acc;
  }, {} as Record<string, CacheMetrics>);
}
