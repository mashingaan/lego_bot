import { Pool, PoolClient } from 'pg';
import * as vercelFunctions from '@vercel/functions';
import { CircuitBreaker, CircuitBreakerOpenError } from '@dialogue-constructor/shared';
import type { Logger } from '@dialogue-constructor/shared';

let pool: Pool | null = null;
let logger: Logger | null = null;
let closePromise: Promise<void> | null = null;
const postgresCircuitBreaker = new CircuitBreaker('postgres', {
  failureThreshold: 5,
  resetTimeout: 30000,
  successThreshold: 2,
  isFailure: (error: unknown) => {
    const err = error as { code?: string; message?: string };
    const code = err?.code || '';
    const message = err?.message || '';
    return /ECONNREFUSED|ETIMEDOUT|ECONNRESET|EPIPE|ENOTFOUND|EAI_AGAIN/i.test(code + message);
  },
});

const postgresRetryStats = { success: 0, failure: 0 };

const isVercel = process.env.VERCEL === '1';
const attachDatabasePoolAvailable =
  isVercel && typeof (vercelFunctions as any).attachDatabasePool === 'function';

export type PostgresRetryConfig = {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  jitterMs: number;
};

export type PostgresPoolConfig = {
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
};

export function getPostgresPoolConfig(): PostgresPoolConfig {
  return isVercel
    ? { max: 2, idleTimeoutMillis: 1000, connectionTimeoutMillis: 3000 }
    : { max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 };
}

export const POSTGRES_RETRY_CONFIG: PostgresRetryConfig = isVercel
  ? {
      maxRetries: 3,
      initialDelayMs: 500,
      maxDelayMs: 1000,
      jitterMs: 1000,
    }
  : {
      maxRetries: 5,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      jitterMs: 2000,
    };

export function getPostgresConnectRetryBudgetMs(): number {
  const { connectionTimeoutMillis } = getPostgresPoolConfig();
  const perAttemptBudgetMs = connectionTimeoutMillis;

  let totalBackoffMs = 0;
  let delayMs = POSTGRES_RETRY_CONFIG.initialDelayMs;

  for (let attempt = 1; attempt < POSTGRES_RETRY_CONFIG.maxRetries; attempt++) {
    totalBackoffMs += Math.min(delayMs, POSTGRES_RETRY_CONFIG.maxDelayMs);
    delayMs = Math.min(delayMs * 2, POSTGRES_RETRY_CONFIG.maxDelayMs);
  }

  return POSTGRES_RETRY_CONFIG.maxRetries * perAttemptBudgetMs + totalBackoffMs;
}

type PostgresConnectionInfo = {
  host: string;
  port: string;
  database: string;
  user: string;
};

function getPostgresConnectionInfo(connectionString: string): PostgresConnectionInfo | null {
  const activePool = pool;

  try {
    const url = new URL(connectionString);
    return {
      host: url.hostname,
      port: url.port || 'default',
      database: url.pathname ? url.pathname.substring(1) : 'not specified',
      user: url.username || 'not specified',
    };
  } catch {
    return null;
  }
}

function formatPostgresConnectionInfo(connectionInfo: PostgresConnectionInfo | null): string {
  if (!connectionInfo) {
    return 'unknown';
  }
  return `${connectionInfo.host}:${connectionInfo.port}/${connectionInfo.database}`;
}

function logConnectionError(service: string, error: unknown, context: Record<string, unknown>) {
  const err = error as { code?: string; message?: string; stack?: string };
  logger?.error({
    timestamp: new Date().toISOString(),
    service,
    code: err?.code,
    message: err?.message || String(error),
    stack: err?.stack,
    ...context,
  }, `${service} connection error`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectWithRetry(
  activePool: Pool,
  connectionInfo: PostgresConnectionInfo | null
): Promise<void> {
  const startTime = Date.now();
  let delayMs = POSTGRES_RETRY_CONFIG.initialDelayMs;

  logger?.info({
    service: 'postgres',
    connection: connectionInfo,
    environment: isVercel ? 'Vercel serverless' : 'Local/traditional',
    maxRetries: POSTGRES_RETRY_CONFIG.maxRetries,
    initialDelayMs: POSTGRES_RETRY_CONFIG.initialDelayMs,
    maxDelayMs: POSTGRES_RETRY_CONFIG.maxDelayMs,
    jitterMs: POSTGRES_RETRY_CONFIG.jitterMs,
  }, 'PostgreSQL connection state: connecting');

  for (let attempt = 1; attempt <= POSTGRES_RETRY_CONFIG.maxRetries; attempt++) {
    const attemptStart = Date.now();
    const attemptStartedAt = new Date(attemptStart).toISOString();
    try {
      const result = await activePool.query('SELECT NOW()');
      postgresRetryStats.success += 1;
      const durationMs = Date.now() - attemptStart;
      const totalDurationMs = Date.now() - startTime;
      logger?.info({
        service: 'postgres',
        attempt,
        attemptStartedAt,
        duration: durationMs,
        durationMs,
        totalDurationMs,
        databaseTime: result.rows?.[0]?.now,
        connection: connectionInfo,
      }, 'PostgreSQL connection state: connected');
      return;
    } catch (error) {
      postgresRetryStats.failure += 1;
      const durationMs = Date.now() - attemptStart;
      const nextDelayMs = Math.min(delayMs, POSTGRES_RETRY_CONFIG.maxDelayMs);
      const jitter = Math.random() * POSTGRES_RETRY_CONFIG.jitterMs;
      const actualDelayMs = nextDelayMs + jitter;
      logConnectionError('postgres', error, {
        service: 'postgres',
        attempt,
        attemptStartedAt,
        duration: durationMs,
        durationMs,
        nextDelayMs: attempt < POSTGRES_RETRY_CONFIG.maxRetries ? nextDelayMs : 0,
        actualDelayMs: attempt < POSTGRES_RETRY_CONFIG.maxRetries ? actualDelayMs : 0,
        connection: connectionInfo,
      });
      if (attempt === POSTGRES_RETRY_CONFIG.maxRetries) {
        const totalDurationMs = Date.now() - startTime;
        logger?.error({
          service: 'postgres',
          attempts: attempt,
          duration: totalDurationMs,
          totalDurationMs,
          connection: connectionInfo,
        }, 'PostgreSQL connection state: error');
        throw new Error(
          `PostgreSQL connection failed after ${attempt} attempts (${formatPostgresConnectionInfo(connectionInfo)})`
        );
      }
      logger?.warn({
        service: 'postgres',
        attempt,
        attemptStartedAt,
        delayMs: nextDelayMs,
        actualDelayMs,
        connection: connectionInfo,
      }, 'PostgreSQL connection retry scheduled');
      await sleep(actualDelayMs);
      delayMs = Math.min(delayMs * 2, POSTGRES_RETRY_CONFIG.maxDelayMs);
    }
  }
}

export async function initPostgres(loggerInstance: Logger): Promise<Pool> {
  logger = loggerInstance;
  postgresCircuitBreaker.setLogger(loggerInstance);
  if (pool) {
    return pool;
  }

  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set in environment variables');
  }

  const poolConfig = getPostgresPoolConfig();
  const connectionInfo = getPostgresConnectionInfo(connectionString);

  const { max, idleTimeoutMillis, connectionTimeoutMillis } = poolConfig;
  logger?.info({
    service: 'postgres',
    connection: connectionInfo,
    hasDatabaseUrl: Boolean(connectionString),
    vercel: process.env.VERCEL,
    environment: isVercel ? 'Vercel serverless' : 'Local/traditional',
    vercelEnv: process.env.VERCEL_ENV,
    poolConfig: { max, idleTimeoutMillis, connectionTimeoutMillis },
    attachDatabasePool: attachDatabasePoolAvailable,
    retryBudgetMs: getPostgresConnectRetryBudgetMs(),
    retryConfig: POSTGRES_RETRY_CONFIG,
  }, '🔧 PostgreSQL pool configuration:');

  // Логируем части URL для диагностики (без паролей)
  if (connectionInfo) {
    logger?.info({
      service: 'postgres',
      connection: connectionInfo,
    }, '📍 PostgreSQL connection info:');
    logger?.info({ service: 'postgres', host: connectionInfo.host }, '  Host:');
    logger?.info({ service: 'postgres', port: connectionInfo.port }, '  Port:');
    logger?.info({ service: 'postgres', database: connectionInfo.database }, '  Database:');
    logger?.info({ service: 'postgres', user: connectionInfo.user }, '  User:');
    logger?.info({ service: 'postgres', password: 'not logged' }, '  Password:');
  } else {
    logger?.warn({ service: 'postgres' }, '⚠️ Could not parse DATABASE_URL (might be invalid format)');
  }

  const candidatePool = new Pool({
    connectionString,
    ...poolConfig,
  });

  candidatePool.on('error', (err) => {
    logConnectionError('postgres', err, {
      service: 'postgres',
      event: 'idle_client_error',
      connection: connectionInfo,
    });
  });

  try {
    await connectWithRetry(candidatePool, connectionInfo);
  } catch (error) {
    try {
      await candidatePool.end();
    } catch (endError) {
      logConnectionError('postgres', endError, {
        service: 'postgres',
        event: 'pool_end_error',
        connection: connectionInfo,
      });
    }
    throw error;
  }

  pool = candidatePool;

  if (attachDatabasePoolAvailable) {
    (vercelFunctions as any).attachDatabasePool(pool);
  }

  return pool;
}

export async function getPostgresClient(): Promise<PoolClient> {
  const connectionString = process.env.DATABASE_URL;
  const connectionInfo = connectionString ? getPostgresConnectionInfo(connectionString) : null;
  logger?.info({
    service: 'postgres',
    connection: connectionInfo,
    exists: Boolean(pool),
  }, '🔊 getPostgresClient - pool exists:');
  
  if (!pool) {
    if (!logger) {
      throw new Error('PostgreSQL logger is not initialized');
    }
    logger.info({
      service: 'postgres',
      connection: connectionInfo,
    }, '📦 Initializing PostgreSQL pool...');
    await initPostgres(logger);
  }
  
  const activePool = pool;
  if (!activePool) {
    logger?.error({
      service: 'postgres',
      connection: connectionInfo,
    }, '❌ PostgreSQL pool is not initialized');
    throw new Error('PostgreSQL pool is not initialized');
  }

  if ((activePool as any).ended) {
    throw new Error(
      `PostgreSQL pool has been closed (${formatPostgresConnectionInfo(connectionInfo)})`
    );
  }

  try {
    logger?.info({
      service: 'postgres',
      connection: connectionInfo,
    }, '🔗 Connecting to PostgreSQL...');
    const client = await postgresCircuitBreaker.execute(() => activePool.connect());
    logger?.info({
      service: 'postgres',
      connection: connectionInfo,
    }, '✅ PostgreSQL client connected');
    return client;
  } catch (error) {
    if (error instanceof CircuitBreakerOpenError) {
      logger?.warn({
        service: 'postgres',
        connection: connectionInfo,
      }, 'PostgreSQL circuit breaker open');
      throw new Error('PostgreSQL is temporarily unavailable (circuit breaker open)');
    }
    logConnectionError('postgres', error, {
      service: 'postgres',
      action: 'connect',
      connection: connectionInfo,
    });
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `PostgreSQL connection failed (${formatPostgresConnectionInfo(connectionInfo)}): ${message}`
    );
  }
}

export function closePostgres(): Promise<void> {
  if (!pool) {
    return Promise.resolve();
  }
  if (closePromise) {
    logger?.info(
      { service: 'postgres', state: 'already_closing' },
      'PostgreSQL pool already closing'
    );
    return closePromise;
  }
  const isEnding = Boolean((pool as any).ending || (pool as any)._ending);
  if (isEnding) {
    logger?.info(
      { service: 'postgres', state: 'already_ending' },
      'Pool already ending'
    );
    return Promise.resolve();
  }
  const activePool = pool;
  closePromise = activePool.end().finally(() => {
    closePromise = null;
    pool = null;
  });
  return closePromise;
}

export function getPool(): Pool | null {
  return pool;
}

export function getPoolStats() {
  if (!pool) {
    return { totalCount: 0, idleCount: 0, waitingCount: 0 };
  }
  return {
    totalCount: (pool as any).totalCount ?? 0,
    idleCount: (pool as any).idleCount ?? 0,
    waitingCount: (pool as any).waitingCount ?? 0,
  };
}

export function getPostgresCircuitBreakerStats() {
  return postgresCircuitBreaker.getStats();
}

export function getPostgresRetryStats() {
  return { ...postgresRetryStats };
}
