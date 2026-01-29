import { Pool, PoolClient } from 'pg';
import { CircuitBreaker, CircuitBreakerOpenError, recordCacheHit, recordCacheMiss } from '@dialogue-constructor/shared';
import type { Logger } from '@dialogue-constructor/shared';
import type { LoggerLike } from '@dialogue-constructor/shared/cache/bot-schema-cache';

let pool: Pool | null = null;
let logger: Logger | null = null;
let closePromise: Promise<void> | null = null;
const isVercel = process.env.VERCEL === '1';

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

import { BotSchema } from '@dialogue-constructor/shared/types/bot-schema';
import { getCachedBotSchema, setCachedBotSchema } from './redis';

export interface Bot {
  id: string;
  user_id: number;
  token: string;
  name: string;
  webhook_secret: string | null;
  schema: BotSchema | null;
  schema_version: number;
  created_at: Date;
  updated_at: Date;
}

const POSTGRES_RETRY_CONFIG = isVercel
  ? {
      maxRetries: 7,
      initialDelayMs: 500,
      maxDelayMs: 15000,
      jitterMs: 1000,
    }
  : {
      maxRetries: 5,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      jitterMs: 2000,
    };

type PostgresConnectionInfo = {
  host: string;
  port: string;
  database: string;
  user: string;
};

function getPostgresConnectionInfo(connectionString: string): PostgresConnectionInfo | null {
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
    operation: 'connect',
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
        operation: 'connect',
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
        operation: 'connect',
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
          operation: 'connect',
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
        operation: 'connect',
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

/**
 * Инициализация пула подключений PostgreSQL
 */
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

  const poolConfig = isVercel
    ? { max: 2, idleTimeoutMillis: 1000, connectionTimeoutMillis: 3000 }
    : { max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 };

  const { max, idleTimeoutMillis, connectionTimeoutMillis } = poolConfig;
  logger?.info({
    service: 'postgres',
    operation: 'init',
    hasDatabaseUrl: Boolean(connectionString),
    vercel: process.env.VERCEL,
    environment: isVercel ? 'Vercel serverless' : 'Local/traditional',
    vercelEnv: process.env.VERCEL_ENV,
    poolConfig: { max, idleTimeoutMillis, connectionTimeoutMillis },
    attachDatabasePool: false,
  }, '🔧 PostgreSQL pool configuration:');

  const connectionInfo = getPostgresConnectionInfo(connectionString);

  const candidatePool = new Pool({
    connectionString,
    ...poolConfig,
  });

  candidatePool.on('error', (err) => {
    logConnectionError('postgres', err, {
      service: 'postgres',
      operation: 'pool_error',
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
        operation: 'pool_end',
        event: 'pool_end_error',
        connection: connectionInfo,
      });
    }
    throw error;
  }

  pool = candidatePool;
  return pool;
}

/**
 * Получить клиент из пула
 */
export async function getPostgresClient(): Promise<PoolClient> {
  const connectionString = process.env.DATABASE_URL;
  const connectionInfo = connectionString ? getPostgresConnectionInfo(connectionString) : null;

  if (!pool) {
    if (!logger) {
      throw new Error('PostgreSQL logger is not initialized');
    }
    await initPostgres(logger);
  }
  
  if (!pool) {
    throw new Error('PostgreSQL pool is not initialized');
  }

  if ((pool as any).ended) {
    throw new Error(
      `PostgreSQL pool has been closed (${formatPostgresConnectionInfo(connectionInfo)})`
    );
  }

  const activePool = pool;

  try {
    return await postgresCircuitBreaker.execute(() => activePool.connect());
  } catch (error) {
    if (error instanceof CircuitBreakerOpenError) {
      logger?.warn({ service: 'postgres', operation: 'connect' }, 'PostgreSQL circuit breaker open');
      throw new Error('PostgreSQL is temporarily unavailable (circuit breaker open)');
    }
    logConnectionError('postgres', error, {
      service: 'postgres',
      operation: 'connect',
      action: 'connect',
      connection: connectionInfo,
    });
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `PostgreSQL connection failed (${formatPostgresConnectionInfo(connectionInfo)}): ${message}`
    );
  }
}

/**
 * Получить бота по ID
 */
export async function getBotById(botId: string): Promise<Bot | null> {
  const client = await getPostgresClient();
  logger?.debug({ service: 'postgres', operation: 'getBotById', botId }, 'PostgreSQL query');
  
  try {
    const result = await client.query<Bot>(
      `SELECT id, user_id, token, name, schema, schema_version, webhook_secret, created_at, updated_at
       FROM bots
       WHERE id = $1`,
      [botId]
    );
    
    return result.rows[0] || null;
  } catch (error) {
    logger?.error(
      { service: 'postgres', operation: 'getBotById', botId, error },
      'PostgreSQL query failed'
    );
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Получить бота по webhook_secret
 */
export async function getBotByWebhookSecret(webhookSecret: string): Promise<Bot | null> {
  const client = await getPostgresClient();
  
  try {
    const result = await client.query<Bot>(
      `SELECT id, user_id, token, name, webhook_set, schema, schema_version, webhook_secret, created_at, updated_at
       FROM bots
       WHERE webhook_secret = $1`,
      [webhookSecret]
    );
    
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

/**
 * Получить схему бота
 */
export async function getBotSchema(botId: string, logger?: LoggerLike): Promise<BotSchema | null> {
  const cached = await getCachedBotSchema(botId, logger);
  if (cached) {
    recordCacheHit('schema');
    logger?.debug?.({ service: 'postgres', operation: 'getBotSchema', botId, source: 'cache' }, 'Schema from cache');
    return cached.schema;
  }

  recordCacheMiss('schema');
  logger?.debug?.({ service: 'postgres', operation: 'getBotSchema', botId, source: 'database' }, 'Schema from database');
  const bot = await getBotById(botId);
  const schema = bot?.schema || null;

  if (schema) {
    await setCachedBotSchema(botId, { schema, schema_version: bot!.schema_version }, logger);
  }

  return schema;
}

/**
 * Закрыть пул подключений
 */
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

export function getPostgresPool(): Pool {
  if (!pool) {
    throw new Error('PostgreSQL pool is not initialized');
  }
  return pool;
}
