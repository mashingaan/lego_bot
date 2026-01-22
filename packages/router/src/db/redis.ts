import { createClient, RedisClientType } from 'redis';

let redisClient: RedisClientType | null = null;

const REDIS_RETRY_CONFIG = {
  maxRetries: 5,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  readyTimeoutMs: 5000,
};

type RedisConnectionInfo = {
  url: string;
  host: string;
  port: string;
};

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

function getRedisState(client: RedisClientType | null): string {
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
  console.error(`${service} connection error`, {
    timestamp: new Date().toISOString(),
    service,
    code: err?.code,
    message: err?.message || String(error),
    stack: err?.stack,
    ...context,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function attachRedisEventHandlers(client: RedisClientType, connectionInfo: RedisConnectionInfo) {
  client.on('error', (err) => {
    logConnectionError('redis', err, {
      state: getRedisState(client),
      connection: connectionInfo,
    });
  });

  client.on('connect', () => {
    console.log('Redis connection state: connecting', {
      connection: connectionInfo,
    });
  });

  client.on('ready', () => {
    console.log('Redis connection state: ready', {
      connection: connectionInfo,
    });
  });

  client.on('reconnecting', () => {
    console.log('Redis connection state: reconnecting', {
      connection: connectionInfo,
    });
  });

  client.on('end', () => {
    console.log('Redis connection state: closed', {
      connection: connectionInfo,
    });
  });
}

function waitForRedisReady(client: RedisClientType, timeoutMs: number): Promise<void> {
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
  client: RedisClientType,
  connectionInfo: RedisConnectionInfo
): Promise<void> {
  const startTime = Date.now();
  let delayMs = REDIS_RETRY_CONFIG.initialDelayMs;

  console.log('Redis connection state: connecting', {
    connection: connectionInfo,
    maxRetries: REDIS_RETRY_CONFIG.maxRetries,
  });

  for (let attempt = 1; attempt <= REDIS_RETRY_CONFIG.maxRetries; attempt++) {
    const attemptStart = Date.now();
    try {
      if (!client.isOpen) {
        await client.connect();
      }
      await waitForRedisReady(client, REDIS_RETRY_CONFIG.readyTimeoutMs);
      const durationMs = Date.now() - attemptStart;
      const totalDurationMs = Date.now() - startTime;
      console.log('Redis connection state: ready', {
        attempt,
        durationMs,
        totalDurationMs,
        connection: connectionInfo,
      });
      return;
    } catch (error) {
      const durationMs = Date.now() - attemptStart;
      const nextDelayMs = Math.min(delayMs, REDIS_RETRY_CONFIG.maxDelayMs);
      logConnectionError('redis', error, {
        attempt,
        durationMs,
        nextDelayMs: attempt < REDIS_RETRY_CONFIG.maxRetries ? nextDelayMs : 0,
        state: getRedisState(client),
        connection: connectionInfo,
      });
      if (attempt === REDIS_RETRY_CONFIG.maxRetries) {
        const totalDurationMs = Date.now() - startTime;
        console.warn('Redis connection state: error', {
          attempts: attempt,
          totalDurationMs,
          connection: connectionInfo,
        });
        throw new Error(
          `Redis connection failed after ${attempt} attempts (${connectionInfo.url})`
        );
      }
      console.warn('Redis connection retry scheduled', {
        attempt,
        delayMs: nextDelayMs,
        connection: connectionInfo,
      });
      await sleep(nextDelayMs);
      delayMs = Math.min(delayMs * 2, REDIS_RETRY_CONFIG.maxDelayMs);
    }
  }
}

/**
 * Инициализация Redis клиента
 */
export async function initRedis(): Promise<RedisClientType | null> {
  if (redisClient && redisClient.isReady) {
    return redisClient;
  }

  const redisUrl = process.env.REDIS_URL
    || (process.env.REDIS_PORT ? `redis://localhost:${process.env.REDIS_PORT}` : 'redis://localhost:6379');
  const connectionInfo = getRedisConnectionInfo(redisUrl);

  if (!redisClient) {
    redisClient = createClient({
      url: redisUrl,
    });
    attachRedisEventHandlers(redisClient, connectionInfo);
  }

  try {
    await connectRedisWithRetry(redisClient, connectionInfo);
    return redisClient;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('Redis initialization failed, continuing without cache:', message);
    console.warn('Redis connection details:', {
      connection: connectionInfo,
      state: getRedisState(redisClient),
    });
    redisClient = null;
    return null;
  }
}

/**
 * Получить Redis клиент
 */
export async function getRedisClient(): Promise<RedisClientType> {
  if (!redisClient || !redisClient.isReady) {
    const client = await initRedis();
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
}

export async function getRedisClientOptional(): Promise<RedisClientType | null> {
  try {
    return await getRedisClient();
  } catch {
    return null;
  }
}

/**
 * Закрыть соединение с Redis
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    console.log('🛑 Closing Redis connection...');
    await redisClient.quit();
    redisClient = null;
  }
}

/**
 * Получить текущее состояние пользователя
 */
export async function getUserState(botId: string, userId: number): Promise<string | null> {
  const client = await getRedisClientOptional();
  if (!client) {
    console.warn('Redis unavailable, skipping getUserState', { botId, userId });
    return null;
  }

  const key = `bot:${botId}:user:${userId}:state`;
  
  try {
    const state = await client.get(key);
    return state;
  } catch (error) {
    console.error('Error getting user state from Redis:', error);
    return null;
  }
}

/**
 * Установить состояние пользователя
 */
export async function setUserState(botId: string, userId: number, state: string): Promise<void> {
  const client = await getRedisClientOptional();
  if (!client) {
    console.warn('Redis unavailable, skipping setUserState', { botId, userId });
    return;
  }

  const key = `bot:${botId}:user:${userId}:state`;
  
  try {
    // Устанавливаем состояние с TTL 30 дней (в секундах)
    await client.setEx(key, 30 * 24 * 60 * 60, state);
  } catch (error) {
    console.error('Error setting user state in Redis:', error);
  }
}

/**
 * Сбросить состояние пользователя
 */
export async function resetUserState(botId: string, userId: number): Promise<void> {
  const client = await getRedisClientOptional();
  if (!client) {
    console.warn('Redis unavailable, skipping resetUserState', { botId, userId });
    return;
  }

  const key = `bot:${botId}:user:${userId}:state`;
  
  try {
    await client.del(key);
  } catch (error) {
    console.error('Error resetting user state in Redis:', error);
  }
}
