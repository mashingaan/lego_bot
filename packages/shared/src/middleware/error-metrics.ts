type ErrorCounts = Record<string, number>;

const WINDOW_MS = 5 * 60 * 1000;
const errorTimestamps: number[] = [];
const errorCountsByType: ErrorCounts = {
  database: 0,
  redis: 0,
  telegram: 0,
  validation: 0,
  unknown: 0,
};
const errorCountsByStatus: ErrorCounts = {};
let totalErrors = 0;
let lastErrorAt: string | null = null;

function pruneOldErrors(now: number) {
  while (errorTimestamps.length > 0 && errorTimestamps[0] < now - WINDOW_MS) {
    errorTimestamps.shift();
  }
}

function classifyErrorType(error: unknown): keyof typeof errorCountsByType {
  const err = error as { name?: string; message?: string; code?: string };
  const name = err?.name || '';
  const message = err?.message || '';
  const code = err?.code || '';

  if (/postgres|database|sql|pg/i.test(name + message + code)) {
    return 'database';
  }
  if (/redis/i.test(name + message + code)) {
    return 'redis';
  }
  if (/telegram/i.test(name + message + code)) {
    return 'telegram';
  }
  if (/validation|invalid/i.test(name + message + code)) {
    return 'validation';
  }
  return 'unknown';
}

export function errorMetricsMiddleware(
  err: unknown,
  req: { method?: string; path?: string },
  res: { statusCode?: number },
  next: (error?: unknown) => void
) {
  const now = Date.now();
  const errorType = classifyErrorType(err);
  const statusCode = (err as any)?.statusCode || (err as any)?.status || res.statusCode || 500;

  totalErrors += 1;
  lastErrorAt = new Date(now).toISOString();
  errorCountsByType[errorType] = (errorCountsByType[errorType] || 0) + 1;
  errorCountsByStatus[String(statusCode)] = (errorCountsByStatus[String(statusCode)] || 0) + 1;
  errorTimestamps.push(now);
  pruneOldErrors(now);

  next(err);
}

export function getErrorMetrics() {
  const now = Date.now();
  pruneOldErrors(now);
  const count = errorTimestamps.length;
  const perMinute = count / (WINDOW_MS / 60000);

  return {
    totalErrors,
    lastErrorAt,
    byType: { ...errorCountsByType },
    byStatus: { ...errorCountsByStatus },
    lastFiveMinutes: {
      count,
      perMinute,
      windowMs: WINDOW_MS,
    },
  };
}
