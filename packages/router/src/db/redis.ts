import { createClient, RedisClientType } from 'redis';
import { CircuitBreaker, CircuitBreakerOpenError } from '@dialogue-constructor/shared';
import type { Logger } from '@dialogue-constructor/shared';
import type { CachedBotSchemaPayload, LoggerLike } from '@dialogue-constructor/shared/cache/bot-schema-cache';
import {
  getCachedBotSchema as getCachedBotSchemaShared,
  setCachedBotSchema as setCachedBotSchemaShared,
  invalidateBotSchemaCache as invalidateBotSchemaCacheShared,
} from '@dialogue-constructor/shared/cache/bot-schema-cache';

type AnyRedisClient = RedisClientType<any, any, any>;

let redisClient: AnyRedisClient | null = null;
let logger: Logger | null = null;
const redisCircuitBreaker = new CircuitBreaker('redis', {
  failureThreshold: 3,
  resetTimeout: 20000,
  successThreshold: 2,
});

const redisRetryStats = { success: 0, failure: 0 };

const isVercel = process.env.VERCEL === '1';
const IN_MEMORY_STATE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const IN_MEMORY_STATE_MAX_SIZE = 10000;
const IN_MEMORY_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const inMemoryStates = new Map<string, { state: string; expiresAt: number }>();
let inMemoryCleanupInterval: ReturnType<typeof setInterval> | null = null;

const REDIS_RETRY_CONFIG = isVercel
  ? {
      maxRetries: 7,
      initialDelayMs: 500,
      maxDelayMs: 10000,
      connectTimeoutMs: 5000,
      readyTimeoutMs: 10000,
      jitterMs: 1000,
    }
  : {
      maxRetries: 5,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      connectTimeoutMs: 5000,
      readyTimeoutMs: 5000,
      jitterMs: 2000,
    };

type RedisConnectionInfo = {
  url: string;
  host: string;
  port: string;
};

function buildStateKey(botId: string, userId: number): string {
  return `bot:${botId}:user:${userId}:state`;
}

function cleanupExpiredStates() {
  const now = Date.now();
  for (const [key, value] of inMemoryStates.entries()) {
    if (value.expiresAt <= now) {
      inMemoryStates.delete(key);
    }
  }
}

function enforceInMemoryLimit() {
  while (inMemoryStates.size > IN_MEMORY_STATE_MAX_SIZE) {
    const firstKey = inMemoryStates.keys().next().value as string | undefined;
    if (!firstKey) {
      break;
    }
    inMemoryStates.delete(firstKey);
  }
}

function scheduleInMemoryCleanup() {
  if (isVercel || inMemoryCleanupInterval) {
    return;
  }
  inMemoryCleanupInterval = setInterval(() => {
    cleanupExpiredStates();
  }, IN_MEMORY_CLEANUP_INTERVAL_MS);
}

function sanitizeRedisUrl(redisUrl: string): string {
  try {
    const url = new URL(redisUrl);
    if (url.password) {
      url.password = '***';
    }
    return url.toString();
  } catch {
    return 'invalid_redis_url';
  }
}

function getRedisConnectionInfo(redisUrl: string): RedisConnectionInfo {
  try {
    const url = new URL(redisUrl);
    return {
      url: sanitizeRedisUrl(redisUrl),
      host: url.hostname,
      port: url.port || 'default',
    };
  } catch {
    return {
      url: 'invalid_redis_url',
      host: 'unknown',
      port: 'unknown',
    };
  }
}

function getRedisState(client: AnyRedisClient | null): string {
  if (!client) {
    return 'closed';
  }
  if (client.isReady) {
    return 'ready';
  }
  if (client.isOpen) {
    return 'connecting';
  }
  return 'closed';
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise
      .then(resolve, reject)
      .finally(() => {
        clearTimeout(timeoutId);
      });
  });
}

function attachRedisEventHandlers(client: AnyRedisClient, connectionInfo: RedisConnectionInfo) {
  client.on('error', (err) => {
    logConnectionError('redis', err, {
      state: getRedisState(client),
      connection: connectionInfo,
    });
  });

  client.on('connect', () => {
    logger?.info({
      service: 'redis',
      operation: 'connect',
      host: connectionInfo.host,
      port: connectionInfo.port,
      connection: connectionInfo,
    }, 'Redis connection state: connecting');
  });

  client.on('ready', () => {
    logger?.info({
      service: 'redis',
      operation: 'connect',
      host: connectionInfo.host,
      port: connectionInfo.port,
      connection: connectionInfo,
    }, 'Redis connection state: ready');
  });

  client.on('reconnecting', () => {
    logger?.warn({
      service: 'redis',
      operation: 'connect',
      host: connectionInfo.host,
      port: connectionInfo.port,
      connection: connectionInfo,
    }, 'Redis connection state: reconnecting');
  });

  client.on('end', () => {
    logger?.info({
      service: 'redis',
      operation: 'connect',
      host: connectionInfo.host,
      port: connectionInfo.port,
      connection: connectionInfo,
    }, 'Redis connection state: closed');
  });
}

function waitForRedisReady(client: AnyRedisClient, timeoutMs: number): Promise<void> {
  if (client.isReady) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`Redis ready timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    const onReady = () => {
      cleanup();
      resolve();
    };

    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    const cleanup = () => {
      clearTimeout(timeoutId);
      client.off('ready', onReady);
      client.off('error', onError);
    };

    client.once('ready', onReady);
    client.once('error', onError);
  });
}

async function connectRedisWithRetry(
  redisUrl: string,
  connectionInfo: RedisConnectionInfo
): Promise<AnyRedisClient> {
  const startTime = Date.now();
  let delayMs = REDIS_RETRY_CONFIG.initialDelayMs;

  logger?.info({
    service: 'redis',
    operation: 'connect',
    host: connectionInfo.host,
    port: connectionInfo.port,
    connection: connectionInfo,
    maxRetries: REDIS_RETRY_CONFIG.maxRetries,
    connectTimeoutMs: REDIS_RETRY_CONFIG.connectTimeoutMs,
    readyTimeoutMs: REDIS_RETRY_CONFIG.readyTimeoutMs,
    jitterMs: REDIS_RETRY_CONFIG.jitterMs,
  }, 'Redis connection state: connecting');

  for (let attempt = 1; attempt <= REDIS_RETRY_CONFIG.maxRetries; attempt++) {
    const attemptStart = Date.now();
    const client = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: REDIS_RETRY_CONFIG.connectTimeoutMs,
      },
    });
    attachRedisEventHandlers(client, connectionInfo);
    try {
      await withTimeout(
        client.connect(),
        REDIS_RETRY_CONFIG.connectTimeoutMs,
        `Redis connect timeout after ${REDIS_RETRY_CONFIG.connectTimeoutMs}ms`
      );
      await waitForRedisReady(client, REDIS_RETRY_CONFIG.readyTimeoutMs);
      redisRetryStats.success += 1;
      const durationMs = Date.now() - attemptStart;
      const totalDurationMs = Date.now() - startTime;
      logger?.info({
        service: 'redis',
        operation: 'connect',
        host: connectionInfo.host,
        port: connectionInfo.port,
        attempt,
        duration: durationMs,
        durationMs,
        totalDurationMs,
        connection: connectionInfo,
      }, 'Redis connection state: ready');
      return client;
    } catch (error) {
      redisRetryStats.failure += 1;
      const durationMs = Date.now() - attemptStart;
      const nextDelayMs = Math.min(delayMs, REDIS_RETRY_CONFIG.maxDelayMs);
      const jitter = Math.random() * REDIS_RETRY_CONFIG.jitterMs;
      const actualDelayMs = nextDelayMs + jitter;
      const state = getRedisState(client);
      logConnectionError('redis', error, {
        service: 'redis',
        operation: 'connect',
        host: connectionInfo.host,
        port: connectionInfo.port,
        attempt,
        duration: durationMs,
        durationMs,
        nextDelayMs: attempt < REDIS_RETRY_CONFIG.maxRetries ? nextDelayMs : 0,
        actualDelayMs: attempt < REDIS_RETRY_CONFIG.maxRetries ? actualDelayMs : 0,
        state,
        connection: connectionInfo,
      });

      try {
        await withTimeout(
          Promise.resolve(client.disconnect()),
          1000,
          'Redis disconnect timeout'
        );
      } catch {
        // best-effort cleanup
      }
      if (attempt === REDIS_RETRY_CONFIG.maxRetries) {
        const totalDurationMs = Date.now() - startTime;
        logger?.warn({
          service: 'redis',
          operation: 'connect',
          host: connectionInfo.host,
          port: connectionInfo.port,
          attempts: attempt,
          duration: totalDurationMs,
          totalDurationMs,
          connection: connectionInfo,
        }, 'Redis connection state: error');
        throw new Error(
          `Redis connection failed after ${attempt} attempts (${connectionInfo.url})`
        );
      }
      logger?.warn({
        service: 'redis',
        operation: 'connect',
        host: connectionInfo.host,
        port: connectionInfo.port,
        attempt,
        delayMs: nextDelayMs,
        actualDelayMs,
        connection: connectionInfo,
      }, 'Redis connection retry scheduled');
      await sleep(actualDelayMs);
      delayMs = Math.min(delayMs * 2, REDIS_RETRY_CONFIG.maxDelayMs);
    }
  }

  throw new Error(
    `Redis connection failed after ${REDIS_RETRY_CONFIG.maxRetries} attempts (${connectionInfo.url})`
  );
}

/**
 * Инициализация Redis клиента
 */
export async function initRedis(loggerInstance: Logger): Promise<AnyRedisClient | null> {
  logger = loggerInstance;
  redisCircuitBreaker.setLogger(loggerInstance);
  if (redisClient && redisClient.isReady) {
    return redisClient;
  }

  logger?.info({
    service: 'redis',
    operation: 'init',
    vercel: process.env.VERCEL,
    vercelEnv: process.env.VERCEL_ENV,
    environment: isVercel ? 'Vercel serverless' : 'Local/traditional',
    retryConfig: {
      maxRetries: REDIS_RETRY_CONFIG.maxRetries,
      initialDelayMs: REDIS_RETRY_CONFIG.initialDelayMs,
      connectTimeoutMs: REDIS_RETRY_CONFIG.connectTimeoutMs,
      readyTimeoutMs: REDIS_RETRY_CONFIG.readyTimeoutMs,
    },
  }, '🔧 Redis retry configuration:');

  const redisUrl = process.env.REDIS_URL
    || (process.env.REDIS_PORT ? `redis://localhost:${process.env.REDIS_PORT}` : 'redis://localhost:6379');
  const connectionInfo = getRedisConnectionInfo(redisUrl);

  if (redisClient) {
    try {
      await withTimeout(
        Promise.resolve(redisClient.disconnect()),
        1000,
        'Redis disconnect timeout'
      );
    } catch {
      // best-effort cleanup
    }
    redisClient = null;
  }

  try {
    redisClient = await connectRedisWithRetry(redisUrl, connectionInfo);
    return redisClient;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.warn({
      service: 'redis',
      operation: 'init',
      host: connectionInfo.host,
      port: connectionInfo.port,
      message,
    }, 'Redis initialization failed, continuing without cache:');
    logger?.warn({
      service: 'redis',
      operation: 'init',
      host: connectionInfo.host,
      port: connectionInfo.port,
      connection: connectionInfo,
      state: getRedisState(redisClient),
    }, 'Redis connection details:');
    redisClient = null;
    return null;
  }
}

/**
 * Получить Redis клиент
 */
export async function getRedisClient(): Promise<AnyRedisClient> {
  return redisCircuitBreaker.execute(async () => {
    if (!redisClient || !redisClient.isReady) {
      if (!logger) {
        throw new Error('Redis logger is not initialized');
      }
      const client = await initRedis(logger);
      if (client && client.isReady) {
        return client;
      }
    }
    if (!redisClient) {
      throw new Error('Redis client is not initialized');
    }
    if (!redisClient.isReady) {
      throw new Error(
        `Redis client is not ready (isOpen=${redisClient.isOpen}, isReady=${redisClient.isReady})`
      );
    }
    return redisClient;
  });
}

export async function getRedisClientOptional(): Promise<AnyRedisClient | null> {
  if (redisCircuitBreaker.getState() === 'open') {
    return null;
  }
  try {
    return await getRedisClient();
  } catch (error) {
    if (error instanceof CircuitBreakerOpenError) {
      return null;
    }
    return null;
  }
}

export async function getCachedBotSchema(botId: string, logger?: LoggerLike): Promise<CachedBotSchemaPayload | null> {
  const client = await getRedisClientOptional();
  if (!client) return null;
  return getCachedBotSchemaShared(client as any, botId, logger);
}

export async function setCachedBotSchema(botId: string, payload: CachedBotSchemaPayload, logger?: LoggerLike): Promise<void> {
  const client = await getRedisClientOptional();
  if (!client) return;
  await setCachedBotSchemaShared(client as any, botId, payload, logger);
}

export async function invalidateBotSchemaCache(botId: string, logger?: LoggerLike): Promise<void> {
  const client = await getRedisClientOptional();
  if (!client) return;
  await invalidateBotSchemaCacheShared(client as any, botId, logger);
}

/**
 * Закрыть соединение с Redis
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    logger?.info({ service: 'redis', operation: 'close' }, '🛑 Closing Redis connection...');
    await redisClient.quit();
    redisClient = null;
  }
}

/**
 * Получить текущее состояние пользователя
 */
export async function getUserState(botId: string, userId: number): Promise<string | null> {
  const client = await getRedisClientOptional();
  const key = buildStateKey(botId, userId);
  if (!client) {
    logger?.warn({
      service: 'redis',
      operation: 'getUserState',
      botId,
      userId,
      fallback: 'memory',
    }, 'Using in-memory state storage');
    scheduleInMemoryCleanup();
    cleanupExpiredStates();
    const entry = inMemoryStates.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      inMemoryStates.delete(key);
      return null;
    }
    return entry.state;
  }
  
  try {
    const state = await client.get(key);
    return state;
  } catch (error) {
    logger?.error({
      service: 'redis',
      operation: 'getUserState',
      botId,
      userId,
      error,
    }, 'Error getting user state from Redis:');
    return null;
  }
}

/**
 * Установить состояние пользователя
 */
export async function setUserState(botId: string, userId: number, state: string): Promise<void> {
  const client = await getRedisClientOptional();
  const key = buildStateKey(botId, userId);
  if (!client) {
    logger?.warn({
      service: 'redis',
      operation: 'setUserState',
      botId,
      userId,
      fallback: 'memory',
    }, 'Using in-memory state storage');
    scheduleInMemoryCleanup();
    cleanupExpiredStates();
    inMemoryStates.set(key, { state, expiresAt: Date.now() + IN_MEMORY_STATE_TTL_MS });
    enforceInMemoryLimit();
    return;
  }
  
  try {
    // Устанавливаем состояние с TTL 30 дней (в секундах)
    await client.setEx(key, 30 * 24 * 60 * 60, state);
  } catch (error) {
    logger?.error({
      service: 'redis',
      operation: 'setUserState',
      botId,
      userId,
      error,
    }, 'Error setting user state in Redis:');
  }
}

/**
 * Сбросить состояние пользователя
 */
export async function resetUserState(botId: string, userId: number): Promise<void> {
  const client = await getRedisClientOptional();
  const key = buildStateKey(botId, userId);
  if (!client) {
    logger?.warn({
      service: 'redis',
      operation: 'resetUserState',
      botId,
      userId,
      fallback: 'memory',
    }, 'Using in-memory state storage');
    cleanupExpiredStates();
    inMemoryStates.delete(key);
    return;
  }
  
  try {
    await client.del(key);
  } catch (error) {
    logger?.error({
      service: 'redis',
      operation: 'resetUserState',
      botId,
      userId,
      error,
    }, 'Error resetting user state in Redis:');
  }
}

export function getRedisCircuitBreakerStats() {
  return redisCircuitBreaker.getStats();
}

export function getRedisRetryStats() {
  return { ...redisRetryStats };
}

export function getInMemoryStateStats() {
  cleanupExpiredStates();
  return {
    count: inMemoryStates.size,
    maxSize: IN_MEMORY_STATE_MAX_SIZE,
  };
}
