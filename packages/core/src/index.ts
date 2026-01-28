import 'express-async-errors';
import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import axios from 'axios';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { Telegraf, session } from 'telegraf';
import { Scenes } from 'telegraf';
import pinoHttp from 'pino-http';
import { z } from 'zod';
import { BOT_LIMITS, RATE_LIMITS, WEBHOOK_INTEGRATION_LIMITS, BotIdSchema, BroadcastIdSchema, CreateBotSchema, CreateBroadcastSchema, PaginationSchema, UpdateBotSchemaSchema, createLogger, createRateLimiter, errorMetricsMiddleware, getErrorMetrics, logBroadcastCreated, logRateLimitMetrics, metricsMiddleware, requestContextMiddleware, requestIdMiddleware, requireBotOwnership, validateBody, validateParams, validateQuery, validateTelegramWebAppData } from '@dialogue-constructor/shared';
import { getRequestId, validateBotSchema } from '@dialogue-constructor/shared/server';
import { initPostgres, closePostgres, getPoolStats, getPostgresCircuitBreakerStats, getPostgresConnectRetryBudgetMs, getPostgresRetryStats, POSTGRES_RETRY_CONFIG, getPostgresClient } from './db/postgres';
import { initRedis, closeRedis, getRedisCircuitBreakerStats, getRedisClientOptional, getRedisRetryStats } from './db/redis';
import { initializeBotsTable, getBotsByUserId, getBotsByUserIdPaginated, getBotById, updateBotSchema, createBot, deleteBot } from './db/bots';
import { exportBotUsersToCSV, getBotTelegramUserIds, getBotUsers, getBotUserStats } from './db/bot-users';
import { exportAnalyticsToCSV, getAnalyticsEvents, getAnalyticsStats, getFunnelData, getPopularPaths, getTimeSeriesData } from './db/bot-analytics';
import { getWebhookLogsByBotId, getWebhookStats } from './db/webhook-logs';
import { cancelBroadcast, createBroadcast, createBroadcastMessages, getBroadcastById, getBroadcastStats, getBroadcastsByBotId, updateBroadcast } from './db/broadcasts';
import { createBotScene } from './bot/scenes';
import { handleStart, handleCreateBot, handleMyBots, handleHelp, handleSetupMiniApp, handleCheckWebhook } from './bot/commands';
import { handleSetWebhook, handleDeleteWebhook } from './bot/webhook-commands';
import { handleEditSchema } from './bot/schema-commands';
import path from 'path';
import * as crypto from 'crypto';
import { decryptToken, encryptToken } from './utils/encryption';
import { processBroadcastAsync } from './services/broadcast-processor';

/**
 * Core Server - Основной сервер приложения
 *
 * Функциональность:
 * - Express API для фронтенда (/api/bots, /api/bot/:id/schema)
 * - Telegram бот (Telegraf) с командами /start, /create_bot, /my_bots, etc.
 * - PostgreSQL для хранения ботов (токены зашифрованы)
 * - Redis для кеширования
 */

// Загрузка .env файла из корня проекта
const envPath = path.resolve(__dirname, '../../../.env');
dotenv.config({ path: envPath });
const logger = createLogger('core');
logger.info({ path: envPath }, '📄 Загрузка .env из:');

let app: ReturnType<typeof express> | null = null;
let appInitialized = false;
const PORT = process.env.PORT || 3000;
const botToken = process.env.TELEGRAM_BOT_TOKEN;
let botInstance: Telegraf<Scenes.SceneContext> | null = null;

export function createApp(): ReturnType<typeof express> {
  if (!app) {
    app = express();
  }
  if (!appInitialized) {
    configureApp(app);
    appInitialized = true;
  }
  return app;
}

// Initialize database connections
let dbInitialized = false;
let dbInitializationPromise: Promise<void> | null = null;
let redisAvailable = true;
let dbInitializationStage: string | null = null;
let lastDatabaseInitialization: {
  startedAt: string | null;
  finishedAt: string | null;
  success: boolean | null;
  durationMs: number | null;
  error: string | null;
} = {
  startedAt: null,
  finishedAt: null,
  success: null,
  durationMs: null,
  error: null,
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, createTimeoutError: () => Error): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(createTimeoutError());
    }, timeoutMs);

    promise
      .then(resolve, reject)
      .finally(() => {
        clearTimeout(timeoutId);
      });
  });
}

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_REGEX = /(\+?\d[\d\s()-]{6,}\d)/g;

const maskSensitive = (value: string) =>
  value.replace(EMAIL_REGEX, '[redacted]').replace(PHONE_REGEX, '[redacted]');

const parseAllowlist = (value?: string) => {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
};

const isIpPrivate = (ip: string) => {
  if (ip.includes(':')) {
    const normalized = ip.toLowerCase();
    return (
      normalized === '::1' ||
      normalized.startsWith('fe80:') ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd')
    );
  }

  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }

  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  return false;
};

const isDisallowedHost = (hostname: string) => {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost')) {
    return true;
  }
  if (isIP(lower)) {
    return isIpPrivate(lower);
  }
  return false;
};

const isAllowedByAllowlist = (hostname: string, allowlist: string[]) => {
  if (allowlist.length === 0) {
    return true;
  }
  const lower = hostname.toLowerCase();
  return allowlist.some((domain) => lower === domain || lower.endsWith(`.${domain}`));
};

async function ensureSafeWebhookUrl(url: string): Promise<URL> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    throw new Error('Webhook URL must use https');
  }

  const allowlist = parseAllowlist(process.env.WEBHOOK_DOMAIN_ALLOWLIST);
  if (!isAllowedByAllowlist(parsed.hostname, allowlist)) {
    throw new Error('Webhook URL is not in allowlist');
  }

  if (isDisallowedHost(parsed.hostname)) {
    throw new Error('Webhook URL points to a disallowed host');
  }

  const resolved = await lookup(parsed.hostname, { all: true });
  for (const record of resolved) {
    if (isDisallowedHost(record.address)) {
      throw new Error('Webhook URL resolves to a disallowed address');
    }
  }

  return parsed;
}

function getSafePostgresConnectionInfo(connectionString: string | undefined): Record<string, string> | null {
  if (!connectionString) {
    return null;
  }

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

async function initializeDatabases() {
  const isVercel = process.env.VERCEL === '1';
  const initializationTimeoutMs = isVercel ? getPostgresConnectRetryBudgetMs() + 2000 : 0;

  if (dbInitialized) {
    logger.info('✅ Databases already initialized');
    return;
  }
  
  if (dbInitializationPromise) {
    logger.info('⏳ Database initialization in progress, waiting...');
    return initializationTimeoutMs
      ? withTimeout(dbInitializationPromise, initializationTimeoutMs, () => {
          return new Error(
            `Database initialization timed out after ${initializationTimeoutMs}ms (stage: ${dbInitializationStage || 'unknown'})`
          );
        })
      : dbInitializationPromise;
  }
  
  logger.info('🚀 Initializing databases...');
  logger.info('🔧 Environment variables:');
  logger.info({ value: process.env.DATABASE_URL ? 'SET' : 'NOT SET' }, '  DATABASE_URL:');
  logger.info({ value: process.env.REDIS_URL ? 'SET' : 'NOT SET' }, '  REDIS_URL:');
  logger.info({ value: process.env.VERCEL }, '  VERCEL:');
  logger.info({ value: process.env.VERCEL_ENV }, '  VERCEL_ENV:');
  
  const initializationStartedAt = Date.now();
  lastDatabaseInitialization = {
    startedAt: new Date(initializationStartedAt).toISOString(),
    finishedAt: null,
    success: null,
    durationMs: null,
    error: null,
  };
  dbInitializationStage = 'postgres';

  dbInitializationPromise = (async () => {
    try {
      const connection = getSafePostgresConnectionInfo(process.env.DATABASE_URL);
      const environment = isVercel ? 'Vercel serverless' : 'Local/traditional';
      logger.info({ connection, environment }, 'PostgreSQL connection state: connecting');
      logger.info('🐘 Initializing PostgreSQL...');
      const postgresStart = Date.now();
      try {
        await initPostgres(logger);
        logger.info({ durationMs: Date.now() - postgresStart }, '✅ PostgreSQL initialized');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const postgresError = new Error(`PostgreSQL initialization failed: ${message}`);
        (postgresError as any).database = 'postgres';
        throw postgresError;
      }
      
      dbInitializationStage = 'redis';
      logger.info('🔴 Initializing Redis...');
      const redisStart = Date.now();
      try {
        const redisClient = await initRedis(logger);
        if (redisClient) {
          logger.info({ durationMs: Date.now() - redisStart }, '✅ Redis initialized');
          redisAvailable = true;
        } else {
          redisAvailable = false;
          logger.warn('⚠️ Redis initialization failed, continuing without cache');
        }
      } catch (error) {
        redisAvailable = false;
        logger.warn({ error }, '⚠️ Redis initialization failed, continuing without cache:');
      }

      dbInitializationStage = 'validate_postgres';
      logger.info('🔍 Validating PostgreSQL connection...');
      const postgresValidationStart = Date.now();
      const { getPool } = await import('./db/postgres');
      const pool = getPool();
      if (!pool) {
        const postgresError = new Error('PostgreSQL pool is not initialized');
        (postgresError as any).database = 'postgres';
        throw postgresError;
      }

      try {
        await pool.query('SELECT 1');
        logger.info(
          { durationMs: Date.now() - postgresValidationStart },
          '✅ PostgreSQL connection verified'
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const postgresError = new Error(`PostgreSQL connection validation failed: ${message}`);
        (postgresError as any).database = 'postgres';
        throw postgresError;
      }

      if (redisAvailable) {
        dbInitializationStage = 'validate_redis';
        try {
          const redisValidationStart = Date.now();
          const { getRedisClient } = await import('./db/redis');
          const redisClient = await getRedisClient();
          await redisClient.ping();
          logger.info(
            { durationMs: Date.now() - redisValidationStart },
            '✅ Redis connection verified'
          );
        } catch (error) {
          redisAvailable = false;
          logger.warn({ error }, '⚠️ Redis ping failed, continuing without cache:');
        }
      }
      
      dbInitializationStage = 'tables';
      logger.info('📉 Initializing bots table...');
      const tablesStart = Date.now();
      // Инициализируем таблицу bots
      await initializeBotsTable();
      logger.info({ durationMs: Date.now() - tablesStart }, '✅ Database tables initialized');
      dbInitialized = true;

      const totalDurationMs = Date.now() - initializationStartedAt;
      lastDatabaseInitialization = {
        ...lastDatabaseInitialization,
        finishedAt: new Date().toISOString(),
        success: true,
        durationMs: totalDurationMs,
        error: null,
      };
      dbInitializationStage = 'done';
      logger.info({ totalDurationMs }, '✅ All databases initialized successfully');
    } catch (error) {
      const totalDurationMs = Date.now() - initializationStartedAt;
      const message = error instanceof Error ? error.message : String(error);
      lastDatabaseInitialization = {
        ...lastDatabaseInitialization,
        finishedAt: new Date().toISOString(),
        success: false,
        durationMs: totalDurationMs,
        error: message,
      };
      logger.error({ error }, '❌ Failed to initialize databases:');
      logger.error({ errorType: error?.constructor?.name }, 'Error type:');
      logger.error({ message }, 'Error message:');
      logger.error(
        { stack: error instanceof Error ? error.stack : 'No stack' },
        'Error stack:'
      );
      dbInitializationPromise = null; // Reset to allow retry
      throw error;
    }
  })();
  
  return initializationTimeoutMs
    ? withTimeout(dbInitializationPromise, initializationTimeoutMs, () => {
        return new Error(
          `Database initialization timed out after ${initializationTimeoutMs}ms (stage: ${dbInitializationStage || 'unknown'})`
        );
      })
    : dbInitializationPromise;
}

let databasesInitialized = false;

async function prewarmConnections() {
  const isVercel = process.env.VERCEL === '1';
  if (!isVercel) {
    return;
  }

  try {
    const client = await getPostgresClient();
    await client.query('SELECT 1');
    client.release();
    logger.info('✅ PostgreSQL connection prewarmed');

    const redisClient = await getRedisClientOptional();
    if (redisClient) {
      await redisClient.ping();
      logger.info('✅ Redis connection prewarmed');
    }
  } catch (error) {
    logger.warn({ error }, '⚠️ Connection prewarming failed');
  }
}

// Middleware для проверки инициализации БД
async function ensureDatabasesInitialized(req: Request, res: Response, next: Function) {
  const requestId = getRequestId() ?? (req as any)?.id ?? 'unknown';
  const middlewareStart = Date.now();
  try {
    logger.info(
      { requestId },
      '🔍 ensureDatabasesInitialized - checking DB initialization...'
    );
    logger.info({ requestId, dbInitialized }, '📉 DB initialized flag:');
    
    if (!databasesInitialized) {
      await initializeDatabases();
      databasesInitialized = true;
      void prewarmConnections();
    }
    logger.info(
      { requestId, durationMs: Date.now() - middlewareStart },
      '✅ Databases initialized, proceeding with request'
    );
    next();
  } catch (error) {
    const durationMs = Date.now() - middlewareStart;
    logger.warn({ requestId, error }, '❌ Database initialization error in middleware:');
    logger.warn({ requestId, errorType: error?.constructor?.name }, 'Error type:');
    logger.warn(
      { requestId, message: error instanceof Error ? error.message : String(error) },
      'Error message:'
    );
    logger.warn(
      { requestId, stack: error instanceof Error ? error.stack : 'No stack' },
      'Error stack:'
    );

    const postgresConnectionInfo = getSafePostgresConnectionInfo(process.env.DATABASE_URL);
    let poolState: Record<string, unknown> = { exists: false };
    try {
      const { getPool } = await import('./db/postgres');
      const pool = getPool();
      if (pool) {
        poolState = {
          exists: true,
          ended: Boolean((pool as any).ended),
          totalCount: (pool as any).totalCount,
          idleCount: (pool as any).idleCount,
          waitingCount: (pool as any).waitingCount,
        };
      }
    } catch (poolError) {
      poolState = {
        exists: 'unknown',
        error: poolError instanceof Error ? poolError.message : String(poolError),
      };
    }
    
    // Логируем переменные окружения (без секретов)
    logger.warn({ requestId }, '🔍 Environment check:');
    logger.warn(
      { requestId, value: process.env.DATABASE_URL ? 'SET' : 'NOT SET' },
      '  DATABASE_URL:'
    );
    logger.warn(
      { requestId, value: process.env.REDIS_URL ? 'SET' : 'NOT SET' },
      '  REDIS_URL:'
    );
    logger.warn({ requestId, value: process.env.VERCEL }, '  VERCEL:');
    logger.warn({ requestId, value: process.env.NODE_ENV }, '  NODE_ENV:');
    logger.warn({ requestId, poolState }, '🔍 PostgreSQL pool state:');
    logger.warn({ requestId, postgresConnectionInfo }, '🔍 PostgreSQL connection info:');
    const failedDatabase = (error as any)?.database || 'postgres';
    const maxRetries = POSTGRES_RETRY_CONFIG.maxRetries;

    if (req.path === '/api/webhook') {
      logger.info({ metric: 'webhook_error', requestId }, 'Webhook error');
    }

    res.status(503).json({ 
      error: 'Service temporarily unavailable',
      message: 'Database initialization failed',
      database: failedDatabase,
      stage: dbInitializationStage,
      attempts: maxRetries,
      totalDurationMs: lastDatabaseInitialization.durationMs ?? durationMs,
      lastError: error instanceof Error ? error.message : String(error),
      recommendation: 'Retry in 5 seconds',
    });
  }
}

// Инициализация БД при запуске (не блокирующая)
if (process.env.VERCEL !== '1' && process.env.NODE_ENV !== 'test') {
  // Локально инициализируем сразу
  initializeDatabases().catch((error) => {
    logger.error({ error }, 'Failed to initialize databases on startup:');
  });
} else {
  // На Vercel инициализируем лениво при первом запросе
  logger.info('📦 Vercel environment detected - databases will be initialized on first request');
}

let apiGeneralLimiter: ReturnType<typeof createRateLimiter> | null = null;
let createBotLimiter: ReturnType<typeof createRateLimiter> | null = null;
let updateSchemaLimiter: ReturnType<typeof createRateLimiter> | null = null;
let exportUsersLimiter: ReturnType<typeof createRateLimiter> | null = null;
let createBroadcastLimiter: ReturnType<typeof createRateLimiter> | null = null;
let rateLimiterInitPromise: Promise<void> | null = null;
let rateLimiterReady: Promise<void> | null = null;

async function initializeRateLimiters() {
  if (apiGeneralLimiter && createBotLimiter && updateSchemaLimiter && exportUsersLimiter && createBroadcastLimiter) {
    return;
  }
  if (!rateLimiterInitPromise) {
    rateLimiterInitPromise = (async () => {
      await initializeDatabases();
      const redisClientOptional = await initRedis(logger);
      if (redisClientOptional) {
        logger.info({ rateLimiting: { backend: 'redis' } }, 'Rate limiting backend initialized');
      }
      apiGeneralLimiter = createRateLimiter(
        redisClientOptional,
        logger,
        RATE_LIMITS.API_GENERAL
      );
      createBotLimiter = createRateLimiter(
        redisClientOptional,
        logger,
        RATE_LIMITS.API_CREATE_BOT
      );
      updateSchemaLimiter = createRateLimiter(
        redisClientOptional,
        logger,
        RATE_LIMITS.API_UPDATE_SCHEMA
      );
      exportUsersLimiter = createRateLimiter(
        redisClientOptional,
        logger,
        { windowMs: 60 * 60 * 1000, max: 5 }
      );
      createBroadcastLimiter = createRateLimiter(
        redisClientOptional,
        logger,
        {
          windowMs: 60 * 60 * 1000,
          max: 10,
          keyGenerator: (req) => `create_broadcast:${req.user.id}`,
        }
      );
    })();
  }
  return rateLimiterInitPromise;
}

export { initializeRateLimiters };
export { setRedisUnavailableForTests } from './db/redis';

const apiGeneralLimiterMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!apiGeneralLimiter) {
      if (!rateLimiterReady) {
        rateLimiterReady = initializeRateLimiters();
      }
      await rateLimiterReady;
    }
    if (apiGeneralLimiter) {
      return apiGeneralLimiter(req, res, next);
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

const createBotLimiterMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!createBotLimiter) {
      if (!rateLimiterReady) {
        rateLimiterReady = initializeRateLimiters();
      }
      await rateLimiterReady;
    }
    if (createBotLimiter) {
      return createBotLimiter(req, res, next);
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

const updateSchemaLimiterMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!updateSchemaLimiter) {
      if (!rateLimiterReady) {
        rateLimiterReady = initializeRateLimiters();
      }
      await rateLimiterReady;
    }
    if (updateSchemaLimiter) {
      return updateSchemaLimiter(req, res, next);
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

const exportUsersLimiterMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!exportUsersLimiter) {
      if (!rateLimiterReady) {
        rateLimiterReady = initializeRateLimiters();
      }
      await rateLimiterReady;
    }
    if (exportUsersLimiter) {
      return exportUsersLimiter(req, res, next);
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

const createBroadcastLimiterMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!createBroadcastLimiter) {
      if (!rateLimiterReady) {
        rateLimiterReady = initializeRateLimiters();
      }
      await rateLimiterReady;
    }
    if (createBroadcastLimiter) {
      return createBroadcastLimiter(req, res, next);
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

function configureApp(app: ReturnType<typeof express>) {
app.set('trust proxy', 1);
app.locals.getBotById = getBotById;
// CORS configuration
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const MINI_APP_URL = process.env.MINI_APP_URL || 'https://lego-bot-miniapp.vercel.app';
const MINI_APP_DEV_URL = 'http://localhost:5174';
const MINI_APP_DEV_URL_127 = 'http://127.0.0.1:5174';
const allowedOrigins = [FRONTEND_URL, MINI_APP_URL, MINI_APP_DEV_URL, MINI_APP_DEV_URL_127].filter(Boolean);

logger.info('🎯 CORS configuration:');
logger.info({ value: FRONTEND_URL }, '  FRONTEND_URL:');
logger.info({ value: MINI_APP_URL }, '  MINI_APP_URL:');
logger.info({ value: MINI_APP_DEV_URL }, '  MINI_APP_DEV_URL:');
logger.info({ value: MINI_APP_DEV_URL_127 }, '  MINI_APP_DEV_URL_127:');
logger.info({ value: allowedOrigins }, '  Allowed origins:');

app.use(cors({
  origin: (origin, callback) => {
    logger.info({ origin }, '🔍 CORS check - origin:');
    // Разрешаем запросы без origin (например, мобильные приложения, Telegram)
    if (!origin) {
      logger.info('✅ CORS: No origin, allowing');
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin) || origin.includes('localhost') || origin.includes('127.0.0.1')) {
      logger.info({ origin }, '✅ CORS: Origin allowed:');
      callback(null, true);
    } else {
      logger.info({ origin }, '✅ CORS: Allowing all origins (permissive mode):');
      callback(null, true); // Разрешаем все для упрощения
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

app.use(requestIdMiddleware());
app.use(requestContextMiddleware());
app.use(pinoHttp({ logger }));
app.use(metricsMiddleware(logger));

// Webhook endpoint для основного бота (должен быть ДО express.json() для raw body)
// Регистрируем сразу, но обработчик будет работать только если botInstance инициализирован
app.post('/api/webhook', express.raw({ type: 'application/json' }), ensureDatabasesInitialized as any, async (req: Request, res: Response) => {
  const requestId = getRequestId() ?? (req as any)?.id ?? 'unknown';
  let updateType: string | undefined;
  let userId: number | null | undefined;
  try {
    logger.info({ requestId }, '✅ Webhook DB initialization complete, processing update');
    // Проверяем, что бот инициализирован
    if (!botInstance) {
      logger.error({ requestId }, '❌ Bot instance not initialized in webhook handler');
      logger.info({ metric: 'webhook_error', requestId }, 'Webhook error');
      return res.status(503).json({ error: 'Bot not initialized' });
    }
    
    const update = JSON.parse(req.body.toString());
    updateType = update.message ? 'message' : update.callback_query ? 'callback_query' : 'unknown';
    userId = update.message?.from?.id ?? update.callback_query?.from?.id ?? null;
    logger.info({
      requestId,
      userId,
      updateId: update.update_id,
      type: updateType,
    }, '📨 Webhook received:');
    
    await botInstance.handleUpdate(update);
    res.status(200).json({ ok: true });
  } catch (error) {
    logger.error({ requestId, error }, '❌ Webhook error:');
    logger.info({ metric: 'webhook_error', requestId, updateType, userId }, 'Webhook error');
    // Всегда возвращаем 200 для Telegram, чтобы не было повторных запросов
    res.status(200).json({ ok: true });
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Apply general rate limiting to all API routes
app.use('/api', apiGeneralLimiterMiddleware as any);
app.use(logRateLimitMetrics(logger));

// Health check
app.get('/health', async (req: Request, res: Response) => {
  const requestId = getRequestId() ?? (req as any)?.id ?? 'unknown';
  const isVercel = process.env.VERCEL === '1';
  const postgresPoolConfig = isVercel
    ? { max: 3, idleTimeoutMillis: 5000, connectionTimeoutMillis: 15000 }
    : { max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 };
  logger.info({ poolConfig: postgresPoolConfig, requestId }, 'PostgreSQL pool configuration');

  const poolInfo = getPoolStats();
  const postgresCircuitBreaker = getPostgresCircuitBreakerStats();
  const redisCircuitBreaker = getRedisCircuitBreakerStats();
  const retryStats = {
    postgres: getPostgresRetryStats(),
    redis: getRedisRetryStats(),
  };
  const errorMetrics = getErrorMetrics();

  let postgresState: 'connecting' | 'ready' | 'error' = 'connecting';
  if (!dbInitialized) {
    postgresState = dbInitializationPromise ? 'connecting' : 'error';
  } else {
    try {
      const { getPool } = await import('./db/postgres');
      const pool = getPool();
      if (pool) {
        await pool.query('SELECT 1');
        postgresState = 'ready';
      } else {
        postgresState = 'error';
      }
    } catch (error) {
      postgresState = 'error';
    }
  }

  let redisState: 'connecting' | 'ready' | 'degraded' | 'error' = 'connecting';
  if (!dbInitialized) {
    redisState = dbInitializationPromise ? 'connecting' : 'error';
  } else if (!redisAvailable) {
    redisState = 'degraded';
  } else {
    try {
      const redisClient = await getRedisClientOptional();
      if (redisClient) {
        await redisClient.ping();
        redisState = 'ready';
      } else {
        redisState = 'degraded';
      }
    } catch (error) {
      redisState = 'error';
    }
  }

  const postgresBreakerOpen = postgresCircuitBreaker.state !== 'closed';
  const redisBreakerOpen = redisCircuitBreaker.state !== 'closed';

  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: {
      vercel: isVercel,
      vercelEnv: process.env.VERCEL_ENV,
      nodeEnv: process.env.NODE_ENV,
    },
    initialization: {
      last: lastDatabaseInitialization,
      stage: dbInitializationStage,
      initialized: dbInitialized,
      inProgress: Boolean(dbInitializationPromise) && !dbInitialized,
    },
    databases: {
      postgres: {
        status: postgresState,
        pool: poolInfo,
        poolConfig: postgresPoolConfig,
      },
      redis: {
        status: redisState,
      },
    },
    circuitBreakers: {
      postgres: postgresCircuitBreaker,
      redis: redisCircuitBreaker,
    },
    connectionPool: {
      postgres: {
        total: poolInfo.totalCount,
        idle: poolInfo.idleCount,
        waiting: poolInfo.waitingCount,
      },
    },
    retryStats,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    errorMetrics,
    rateLimiting: {
      enabled: redisState === 'ready',
      backend: redisState === 'ready' ? 'redis' : 'memory',
    },
  };

  if (postgresState === 'ready' && !postgresBreakerOpen) {
    health.status = redisState === 'ready' && !redisBreakerOpen ? 'ok' : 'degraded';
  } else {
    health.status = 'error';
  }

  const statusCode = health.status === 'error' ? 503 : 200;
  logger.info(
    { requestId, status: health.status, databases: health.databases },
    'Health check'
  );
  res.status(statusCode).json(health);
});

// Middleware для проверки user_id через Telegram WebApp initData
async function requireUserId(req: Request, res: Response, next: Function) {
  const initData =
    (req.headers['x-telegram-init-data'] as string | undefined)
    || (req.query.initData as string | undefined);

  if (!initData) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const botToken = process.env.BOT_TOKEN;
  if (!botToken) {
    return res.status(500).json({ error: 'BOT_TOKEN is not set' });
  }

  const validation = validateTelegramWebAppData(initData, botToken);
  if (!validation.valid || !validation.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  (req as any).user = { id: validation.userId };
  next();
}

// API Routes

// POST /api/bots - создать бота
app.post('/api/bots', ensureDatabasesInitialized as any, validateBody(CreateBotSchema) as any, requireUserId as any, createBotLimiterMiddleware as any, async (req: Request, res: Response) => {
  const requestId = getRequestId() ?? (req as any)?.id ?? 'unknown';
  try {
    const userId = (req as any).user.id;
    const { token, name } = req.body || {};

    // Проверка количества ботов пользователя
    const userBots = await getBotsByUserId(userId);
    if (userBots.length >= BOT_LIMITS.MAX_BOTS_PER_USER) {
      logger.warn({ userId, currentCount: userBots.length, requestId }, 'Bot creation limit reached');
      return res.status(429).json({
        error: 'Bot limit reached',
        message: `You can create maximum ${BOT_LIMITS.MAX_BOTS_PER_USER} bots`,
        currentCount: userBots.length,
        maxAllowed: BOT_LIMITS.MAX_BOTS_PER_USER,
      });
    }

    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      return res.status(500).json({ error: 'ENCRYPTION_KEY is not set' });
    }

    const duplicateToken = userBots.some((bot) => {
      try {
        return decryptToken(bot.token, encryptionKey) === token;
      } catch {
        return false;
      }
    });
    if (duplicateToken) {
      return res.status(409).json({ error: 'Bot token already exists' });
    }

    const encryptedToken = encryptToken(token, encryptionKey);
    const context = (req as any).context;
    const bot = await createBot({ user_id: userId, token: encryptedToken, name }, context);

    res.json({
      id: bot.id,
      name: bot.name,
      webhook_set: bot.webhook_set,
      schema_version: bot.schema_version,
      created_at: bot.created_at,
    });
  } catch (error) {
    logger.error({ requestId, error }, '❌ Error creating bot:');
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// GET /api/bots - получить список ботов пользователя
app.get('/api/bots', ensureDatabasesInitialized as any, validateQuery(PaginationSchema) as any, requireUserId as any, async (req: Request, res: Response) => {
  const requestId = getRequestId() ?? (req as any)?.id ?? 'unknown';
  try {
    const userId = (req as any).user.id;
    const parsed = PaginationSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query', details: parsed.error.errors });
    }
    const { limit, cursor } = parsed.data;

    logger.info({ userId, requestId, limit, cursorPresent: Boolean(cursor) }, '📋 GET /api/bots');
    
    const startTime = Date.now();
    const result = await getBotsByUserIdPaginated(userId, { limit, cursor });
    const duration = Date.now() - startTime;
    logger.info(
      { metric: 'db_query', operation: 'getBotsByUserIdPaginated', userId, count: result.bots.length, duration, requestId },
      'Bots fetched'
    );
    logger.info({ userId, requestId, count: result.bots.length }, '✅ Found bots:');
    logger.info(
      { metric: 'active_bots', userId, count: result.bots.length, requestId },
      'Active bots count'
    );
    
    // Убираем токены из ответа
    const safeBots = result.bots.map(bot => ({
      id: bot.id,
      name: bot.name,
      webhook_set: bot.webhook_set,
      schema_version: bot.schema_version,
      created_at: bot.created_at,
    }));
    
    logger.info({ userId, requestId, count: safeBots.length }, '✅ Returning safe bots:');
    res.json({
      bots: safeBots,
      pagination: {
        limit,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
      },
    });
  } catch (error) {
    logger.error({ requestId, error }, '❌ Error fetching bots:');
    logger.error(
      { requestId, stack: error instanceof Error ? error.stack : 'No stack' },
      'Error stack:'
    );
    logger.error(
      { requestId, message: error instanceof Error ? error.message : String(error) },
      'Error message:'
    );
    res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// GET /api/bot/:id - получить бота
app.get('/api/bot/:id', ensureDatabasesInitialized as any, validateParams(z.object({ id: BotIdSchema })) as any, requireUserId as any, requireBotOwnership() as any, async (req: Request, res: Response) => {
  const requestId = getRequestId() ?? (req as any)?.id ?? 'unknown';
  try {
    const bot = (req as any).bot;

    res.json({
      id: bot.id,
      name: bot.name,
      webhook_set: bot.webhook_set,
      schema_version: bot.schema_version,
      created_at: bot.created_at,
    });
  } catch (error) {
    logger.error({ requestId, error }, 'Error fetching bot:');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/bot/:id/schema - получить схему бота
app.get('/api/bot/:id/schema', ensureDatabasesInitialized as any, validateParams(z.object({ id: BotIdSchema })) as any, requireUserId as any, requireBotOwnership() as any, async (req: Request, res: Response) => {
  const requestId = getRequestId() ?? (req as any)?.id ?? 'unknown';
  try {
    const bot = (req as any).bot;
    const userId = (req as any).user.id;
    const botId = req.params.id;

    if (!bot.schema) {
      logger.warn({ userId, botId, requestId }, 'Schema not found');
      return res.status(404).json({ error: 'Schema not found' });
    }
    
    logger.info({ userId, botId, requestId }, 'Schema fetched');
    res.json(bot.schema);
  } catch (error) {
    logger.error({ requestId, error }, 'Error fetching schema:');
    res.status(500).json({ error: 'Internal server error' });
  }
});

const updateSchemaHandler = async (req: Request, res: Response) => {
  const requestId = getRequestId() ?? (req as any)?.id ?? 'unknown';
  try {
    const userId = (req as any).user.id;
    const botId = req.params.id;
    const schema = req.body;
    const bot = (req as any).bot;

    const stateCount = Object.keys((schema as any)?.states ?? {}).length;
    if (stateCount > BOT_LIMITS.MAX_SCHEMA_STATES) {
      logger.warn({ userId, botId, requestId, error: 'Schema too large', currentCount: stateCount }, 'Invalid schema');
      return res.status(400).json({
        error: 'Schema too large',
        message: `Maximum ${BOT_LIMITS.MAX_SCHEMA_STATES} states allowed`,
        currentCount: stateCount,
      });
    }

    const schemaValidation = validateBotSchema(schema);
    if (!schemaValidation.valid) {
      logger.warn({ userId, botId, requestId, errors: schemaValidation.errors }, 'Invalid schema');
      return res.status(400).json({ error: 'Invalid schema', errors: schemaValidation.errors });
    }
    
    // Обновляем схему
    const updateStart = Date.now();
    let success: boolean;
    const context = (req as any).context;
    try {
      success = await updateBotSchema(botId, userId, schema, context);
    } catch (error) {
      logger.error({ userId, botId, requestId, error }, 'Failed to update schema');
      throw error;
    }
    const updateDuration = Date.now() - updateStart;
    logger.info(
      { metric: 'db_query', operation: 'updateBotSchema', userId, botId, duration: updateDuration, requestId },
      'Schema updated'
    );
    if (!success) {
      logger.error({ userId, botId, requestId }, 'Schema update failed');
      return res.status(500).json({ error: 'Failed to update schema' });
    }
    
    const newSchemaVersion = (bot.schema_version || 0) + 1;
    const redisClient = await getRedisClientOptional();
    if (redisClient) {
      await redisClient.del(`bot:${botId}:schema`);
      logger.info({ userId, botId, requestId }, 'Schema cache invalidated');
    }

    logger.info({ userId, botId, requestId }, 'Schema update response sent');
    res.json({ 
      success: true, 
      message: 'Schema updated successfully',
      schema_version: newSchemaVersion
    });
  } catch (error) {
    logger.error({ requestId, error }, 'Error updating schema:');
    res.status(500).json({ error: 'Internal server error' });
  }
};

const TestWebhookSchema = z.object({
  stateKey: z.string(),
});
const IsoDateSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Invalid date',
});
const AnalyticsEventsQuerySchema = PaginationSchema.extend({
  event_type: z.string().optional(),
  date_from: IsoDateSchema.optional(),
  date_to: IsoDateSchema.optional(),
});
const AnalyticsStatsQuerySchema = z.object({
  date_from: IsoDateSchema.optional(),
  date_to: IsoDateSchema.optional(),
});
const AnalyticsPathsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
  date_from: IsoDateSchema.optional(),
  date_to: IsoDateSchema.optional(),
});
const AnalyticsFunnelQuerySchema = z.object({
  states: z.string(),
  date_from: IsoDateSchema.optional(),
  date_to: IsoDateSchema.optional(),
});
const AnalyticsTimeSeriesQuerySchema = z.object({
  event_type: z.string(),
  date_from: IsoDateSchema.optional(),
  date_to: IsoDateSchema.optional(),
  granularity: z.enum(['hour', 'day', 'week']).optional(),
});
const AnalyticsExportQuerySchema = z.object({
  date_from: IsoDateSchema.optional(),
  date_to: IsoDateSchema.optional(),
});

// POST /api/bot/:id/schema - обновить схему бота
app.post('/api/bot/:id/schema', ensureDatabasesInitialized as any, validateParams(z.object({ id: BotIdSchema })) as any, validateBody(UpdateBotSchemaSchema) as any, requireUserId as any, requireBotOwnership() as any, updateSchemaLimiterMiddleware as any, updateSchemaHandler as any);
// PUT /api/bot/:id/schema - обновить схему бота
app.put('/api/bot/:id/schema', ensureDatabasesInitialized as any, validateParams(z.object({ id: BotIdSchema })) as any, validateBody(UpdateBotSchemaSchema) as any, requireUserId as any, requireBotOwnership() as any, updateSchemaLimiterMiddleware as any, updateSchemaHandler as any);

// GET /api/bot/:id/webhooks - получить логи webhook
app.get('/api/bot/:id/webhooks', ensureDatabasesInitialized as any, validateParams(z.object({ id: BotIdSchema })) as any, validateQuery(PaginationSchema) as any, requireUserId as any, requireBotOwnership() as any, async (req: Request, res: Response) => {
  const requestId = getRequestId() ?? (req as any)?.id ?? 'unknown';
  try {
    const botId = req.params.id;
    const parsed = PaginationSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query', details: parsed.error.errors });
    }
    const { limit, cursor } = parsed.data;
    const result = await getWebhookLogsByBotId(botId, { limit, cursor });
    res.json({ logs: result.logs, nextCursor: result.nextCursor, hasMore: result.hasMore });
  } catch (error) {
    logger.error({ requestId, error }, 'Error fetching webhook logs:');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/bot/:id/webhooks/stats - статистика webhook
app.get('/api/bot/:id/webhooks/stats', ensureDatabasesInitialized as any, validateParams(z.object({ id: BotIdSchema })) as any, requireUserId as any, requireBotOwnership() as any, async (req: Request, res: Response) => {
  const requestId = getRequestId() ?? (req as any)?.id ?? 'unknown';
  try {
    const botId = req.params.id;
    const stats = await getWebhookStats(botId);
    const total = stats.reduce((sum, row) => sum + row.total, 0);
    const success = stats.reduce((sum, row) => sum + row.success_count, 0);
    const successRate = total > 0 ? success / total : 0;

    res.json({ total, successRate, states: stats });
  } catch (error) {
    logger.error({ requestId, error }, 'Error fetching webhook stats:');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/bot/:id/test-webhook - тестовая отправка webhook
app.post('/api/bot/:id/test-webhook', ensureDatabasesInitialized as any, validateParams(z.object({ id: BotIdSchema })) as any, validateBody(TestWebhookSchema) as any, requireUserId as any, requireBotOwnership() as any, async (req: Request, res: Response) => {
  const requestId = getRequestId() ?? (req as any)?.id ?? 'unknown';
  try {
    const botId = req.params.id;
    const { stateKey } = req.body as { stateKey: string };
    const bot = (req as any).bot;

    if (!bot?.schema || !bot.schema.states?.[stateKey]) {
      return res.status(404).json({ error: 'State not found' });
    }

    const state = bot.schema.states[stateKey];
    if (!state.webhook?.url || !state.webhook.enabled) {
      return res.status(400).json({ error: 'Webhook is not enabled for this state' });
    }

    await ensureSafeWebhookUrl(state.webhook.url);

    const payload = {
      bot_id: botId,
      user_id: 0,
      state_key: stateKey,
      timestamp: new Date().toISOString(),
      user: {
        first_name: 'Test',
        phone_number: null,
        email: null,
      },
      context: {
        previous_state: null,
      },
    };
    const routerInternalUrl = process.env.ROUTER_INTERNAL_URL;
    if (!routerInternalUrl) {
      return res.status(500).json({ error: 'Router internal URL is not configured' });
    }

    const targetUrl = `${routerInternalUrl.replace(/\/$/, '')}/internal/test-webhook`;
    const headers: Record<string, string> = {};
    if (process.env.ROUTER_INTERNAL_SECRET) {
      headers['x-internal-secret'] = process.env.ROUTER_INTERNAL_SECRET;
    }

    const response = await axios.post(
      targetUrl,
      { webhook: state.webhook, payload },
      {
        headers,
        timeout: WEBHOOK_INTEGRATION_LIMITS.AWAIT_FIRST_ATTEMPT_TIMEOUT_MS,
        validateStatus: () => true,
      }
    );

    const data = response.data ?? {};
    res.json({
      success: Boolean(data.success),
      status: data.status ?? response.status,
      response: data.response ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ requestId, error: maskSensitive(message) }, 'Error testing webhook:');
    res.status(500).json({ error: 'Webhook test failed', message });
  }
});

// GET /api/bot/:id/users - получить список контактов
app.get('/api/bot/:id/users', ensureDatabasesInitialized as any, validateParams(z.object({ id: BotIdSchema })) as any, validateQuery(PaginationSchema) as any, requireUserId as any, requireBotOwnership() as any, apiGeneralLimiterMiddleware as any, async (req: Request, res: Response) => {
  const requestId = getRequestId() ?? (req as any)?.id ?? 'unknown';
  try {
    const userId = (req as any).user.id;
    const botId = req.params.id;
    const parsed = PaginationSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query', details: parsed.error.errors });
    }
    const { limit, cursor } = parsed.data;

    const result = await getBotUsers(botId, userId, { limit, cursor });
    logger.info({ metric: 'bot_users_fetched', botId, count: result.users.length, requestId }, 'Bot users fetched');
    res.json({ users: result.users, nextCursor: result.nextCursor, hasMore: result.hasMore });
  } catch (error) {
    logger.error({ requestId, error }, 'Error fetching bot users:');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/bot/:id/users/stats - статистика контактов
app.get('/api/bot/:id/users/stats', ensureDatabasesInitialized as any, validateParams(z.object({ id: BotIdSchema })) as any, requireUserId as any, requireBotOwnership() as any, async (req: Request, res: Response) => {
  const requestId = getRequestId() ?? (req as any)?.id ?? 'unknown';
  try {
    const userId = (req as any).user.id;
    const botId = req.params.id;

    const stats = await getBotUserStats(botId, userId);
    res.json(stats);
  } catch (error) {
    logger.error({ requestId, error }, 'Error fetching bot users stats:');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/bot/:id/users/export - экспорт в CSV
app.get('/api/bot/:id/users/export', ensureDatabasesInitialized as any, validateParams(z.object({ id: BotIdSchema })) as any, requireUserId as any, requireBotOwnership() as any, exportUsersLimiterMiddleware as any, async (req: Request, res: Response) => {
  const requestId = getRequestId() ?? (req as any)?.id ?? 'unknown';
  try {
    const userId = (req as any).user.id;
    const botId = req.params.id;

    const csv = await exportBotUsersToCSV(botId, userId);
    logger.info({ metric: 'bot_users_exported', botId, requestId }, 'Bot users exported');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="contacts-${botId}.csv"`);
    res.send(csv);
  } catch (error) {
    logger.error({ requestId, error }, 'Error exporting bot users:');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/bot/:id/analytics/events - получить события
app.get('/api/bot/:id/analytics/events', ensureDatabasesInitialized as any, validateParams(z.object({ id: BotIdSchema })) as any, validateQuery(AnalyticsEventsQuerySchema) as any, requireUserId as any, requireBotOwnership() as any, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const botId = req.params.id;
    const parsed = AnalyticsEventsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query', details: parsed.error.errors });
    }
    const { limit, cursor, event_type, date_from, date_to } = parsed.data;
    const result = await getAnalyticsEvents(botId, userId, {
      limit,
      cursor,
      eventType: event_type,
      dateFrom: date_from,
      dateTo: date_to,
    });
    res.json({ events: result.events, nextCursor: result.nextCursor, hasMore: result.hasMore });
  } catch (error) {
    logger.error({ error }, 'Error fetching analytics events:');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/bot/:id/analytics/stats - получить статистику
app.get('/api/bot/:id/analytics/stats', ensureDatabasesInitialized as any, validateParams(z.object({ id: BotIdSchema })) as any, validateQuery(AnalyticsStatsQuerySchema) as any, requireUserId as any, requireBotOwnership() as any, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const botId = req.params.id;
    const parsed = AnalyticsStatsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query', details: parsed.error.errors });
    }
    const { date_from, date_to } = parsed.data;
    const stats = await getAnalyticsStats(botId, userId, date_from, date_to);
    res.json(stats);
  } catch (error) {
    logger.error({ error }, 'Error fetching analytics stats:');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/bot/:id/analytics/paths - получить популярные пути
app.get('/api/bot/:id/analytics/paths', ensureDatabasesInitialized as any, validateParams(z.object({ id: BotIdSchema })) as any, validateQuery(AnalyticsPathsQuerySchema) as any, requireUserId as any, requireBotOwnership() as any, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const botId = req.params.id;
    const parsed = AnalyticsPathsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query', details: parsed.error.errors });
    }
    const { limit, date_from, date_to } = parsed.data;
    const paths = await getPopularPaths(botId, userId, limit, date_from, date_to);
    res.json({ paths });
  } catch (error) {
    logger.error({ error }, 'Error fetching analytics paths:');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/bot/:id/analytics/funnel - получить данные воронки
app.get('/api/bot/:id/analytics/funnel', ensureDatabasesInitialized as any, validateParams(z.object({ id: BotIdSchema })) as any, validateQuery(AnalyticsFunnelQuerySchema) as any, requireUserId as any, requireBotOwnership() as any, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const botId = req.params.id;
    const parsed = AnalyticsFunnelQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query', details: parsed.error.errors });
    }
    const { states, date_from, date_to } = parsed.data;
    const stateKeys = states.split(',').map((state) => state.trim()).filter(Boolean);
    const steps = await getFunnelData(botId, userId, stateKeys, date_from, date_to);
    res.json({ steps });
  } catch (error) {
    logger.error({ error }, 'Error fetching analytics funnel:');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/bot/:id/analytics/timeseries - получить временной ряд
app.get('/api/bot/:id/analytics/timeseries', ensureDatabasesInitialized as any, validateParams(z.object({ id: BotIdSchema })) as any, validateQuery(AnalyticsTimeSeriesQuerySchema) as any, requireUserId as any, requireBotOwnership() as any, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const botId = req.params.id;
    const parsed = AnalyticsTimeSeriesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query', details: parsed.error.errors });
    }
    const { event_type, date_from, date_to, granularity } = parsed.data;
    const data = await getTimeSeriesData(botId, userId, event_type, date_from, date_to, granularity);
    res.json({ data });
  } catch (error) {
    logger.error({ error }, 'Error fetching analytics timeseries:');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/bot/:id/analytics/export - экспорт отчета
app.get('/api/bot/:id/analytics/export', ensureDatabasesInitialized as any, validateParams(z.object({ id: BotIdSchema })) as any, validateQuery(AnalyticsExportQuerySchema) as any, requireUserId as any, requireBotOwnership() as any, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const botId = req.params.id;
    const parsed = AnalyticsExportQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query', details: parsed.error.errors });
    }
    const { date_from, date_to } = parsed.data;
    const csv = await exportAnalyticsToCSV(botId, userId, date_from, date_to);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="analytics-${botId}.csv"`);
    res.send(csv);
  } catch (error) {
    logger.error({ error }, 'Error exporting analytics:');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/bot/:id/broadcasts - создать рассылку
app.post('/api/bot/:id/broadcasts',
  ensureDatabasesInitialized as any,
  validateParams(z.object({ id: BotIdSchema })) as any,
  validateBody(CreateBroadcastSchema) as any,
  requireUserId as any,
  requireBotOwnership() as any,
  createBroadcastLimiterMiddleware as any,
  async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const botId = req.params.id;
    const data = req.body;

    const userIds = await getBotTelegramUserIds(botId, userId);
    const broadcast = await createBroadcast(botId, userId, {
      ...data,
      totalRecipients: userIds.length,
    });
    await createBroadcastMessages(broadcast.id, userIds);
    logBroadcastCreated(logger, {
      broadcastId: broadcast.id,
      botId,
      totalRecipients: userIds.length,
    });
    res.json(broadcast);
  }
);

// GET /api/bot/:id/broadcasts - список рассылок
app.get('/api/bot/:id/broadcasts',
  ensureDatabasesInitialized as any,
  validateParams(z.object({ id: BotIdSchema })) as any,
  validateQuery(PaginationSchema) as any,
  requireUserId as any,
  requireBotOwnership() as any,
  async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const botId = req.params.id;
    const parsed = PaginationSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query', details: parsed.error.errors });
    }
    const { limit, cursor } = parsed.data;

    const result = await getBroadcastsByBotId(botId, userId, { limit, cursor });
    res.json(result);
  }
);

// GET /api/bot/:id/broadcasts/:broadcastId - детали рассылки
app.get('/api/bot/:id/broadcasts/:broadcastId',
  ensureDatabasesInitialized as any,
  validateParams(z.object({ id: BotIdSchema, broadcastId: BroadcastIdSchema })) as any,
  requireUserId as any,
  requireBotOwnership() as any,
  async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const { broadcastId } = req.params;

    const broadcast = await getBroadcastById(broadcastId, userId);
    if (!broadcast) {
      return res.status(404).json({ error: 'Broadcast not found' });
    }

    const stats = await getBroadcastStats(broadcastId);
    res.json({ ...broadcast, stats });
  }
);

// POST /api/bot/:id/broadcasts/:broadcastId/start - запустить рассылку
app.post('/api/bot/:id/broadcasts/:broadcastId/start',
  ensureDatabasesInitialized as any,
  validateParams(z.object({ id: BotIdSchema, broadcastId: BroadcastIdSchema })) as any,
  requireUserId as any,
  requireBotOwnership() as any,
  async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const { broadcastId } = req.params;

    const broadcast = await getBroadcastById(broadcastId, userId);
    if (!broadcast || broadcast.status !== 'draft') {
      return res.status(400).json({ error: 'Cannot start this broadcast' });
    }

    await updateBroadcast(broadcastId, { status: 'processing' });
    processBroadcastAsync(broadcastId);

    res.json({ success: true });
  }
);

// POST /api/bot/:id/broadcasts/:broadcastId/cancel - отменить рассылку
app.post('/api/bot/:id/broadcasts/:broadcastId/cancel',
  ensureDatabasesInitialized as any,
  validateParams(z.object({ id: BotIdSchema, broadcastId: BroadcastIdSchema })) as any,
  requireUserId as any,
  requireBotOwnership() as any,
  async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const { broadcastId } = req.params;

    await cancelBroadcast(broadcastId, userId);
    res.json({ success: true });
  }
);

// POST /api/internal/process-broadcast - internal processing trigger
app.post('/api/internal/process-broadcast',
  ensureDatabasesInitialized as any,
  validateBody(z.object({ broadcastId: BroadcastIdSchema })) as any,
  async (req: Request, res: Response) => {
    const requestId = getRequestId() ?? (req as any)?.id ?? 'unknown';
    const internalSecret = process.env.CORE_INTERNAL_SECRET;
    const providedSecret = req.headers['x-internal-secret'];
    if (!internalSecret || providedSecret !== internalSecret) {
      logger.warn({ requestId }, 'Unauthorized internal process-broadcast attempt');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { broadcastId } = req.body as { broadcastId: string };
    const broadcast = await getBroadcastById(broadcastId, null);
    if (!broadcast) {
      logger.warn({ requestId, broadcastId }, 'Broadcast not found for processing');
      return res.status(404).json({ error: 'Broadcast not found' });
    }

    if (broadcast.status !== 'scheduled' && broadcast.status !== 'processing') {
      logger.warn({ requestId, broadcastId, status: broadcast.status }, 'Broadcast status not allowed for processing');
      return res.status(400).json({ error: 'Broadcast status not allowed' });
    }

    if (broadcast.status === 'scheduled') {
      await updateBroadcast(broadcastId, { status: 'processing' });
    }
    processBroadcastAsync(broadcastId);
    res.json({ success: true });
  }
);
// DELETE /api/bot/:id - удалить бота
app.delete('/api/bot/:id', ensureDatabasesInitialized as any, validateParams(z.object({ id: BotIdSchema })) as any, requireUserId as any, requireBotOwnership() as any, async (req: Request, res: Response) => {
  const requestId = getRequestId() ?? (req as any)?.id ?? 'unknown';
  try {
    const userId = (req as any).user.id;
    const botId = req.params.id;

    const context = (req as any).context;
    const deleted = await deleteBot(botId, userId, context);
    if (!deleted) {
      logger.error({ userId, botId, requestId }, 'Bot delete failed');
      return res.status(500).json({ error: 'Failed to delete bot' });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error({ requestId, error }, 'Error deleting bot:');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Initialize Telegram bot
if (!botToken) {
  logger.warn('⚠️  TELEGRAM_BOT_TOKEN is not set');
  logger.warn('⚠️  Бот не будет запущен. Установите TELEGRAM_BOT_TOKEN в .env файле');
} else {
  logger.info({ tokenPrefix: botToken.substring(0, 10) + '...' }, '🔑 Токен бота найден:');
  // Создание бота с поддержкой сцен (FSM)
  botInstance = new Telegraf<Scenes.SceneContext>(botToken);
  
  // Настройка сессий (используем память для простоты, в продакшене лучше Redis)
  botInstance.use(session());
  
  // Регистрация сцен
  const stage = new Scenes.Stage<Scenes.SceneContext>([createBotScene as any]);
  botInstance.use(stage.middleware());
  
  // Логирование всех входящих обновлений для отладки (ПОСЛЕ middleware, НО перед командами)
  botInstance.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    const command = ctx.message && 'text' in ctx.message && ctx.message.text?.startsWith('/') ? ctx.message.text : undefined;
    logger.info({
      userId,
      command,
      updateId: ctx.update.update_id,
      type: ctx.updateType,
      from: userId,
      username: ctx.from?.username,
      text: ctx.message && 'text' in ctx.message ? ctx.message.text : undefined,
      chatId: ctx.chat?.id,
    }, '📨 Получено обновление:');
    return next();
  });
  
  // Регистрация команд
  botInstance.command('start', async (ctx) => {
    const userId = ctx.from?.id;
    const command = '/start';
    logger.info({ userId, command, username: ctx.from?.username }, '🎯 Команда /start получена');
    try {
      await handleStart(ctx as any);
      logger.info({ userId, command }, '✅ Команда /start обработана успешно');
    } catch (error) {
      logger.error({ userId, command, error }, '❌ Error in /start command:');
      try {
        await ctx.reply('❌ Произошла ошибка при обработке команды.');
      } catch (replyError) {
        logger.error({ userId, command, error: replyError }, '❌ Failed to send error message:');
      }
    }
  });
  
  botInstance.command('create_bot', async (ctx) => {
    const userId = ctx.from?.id;
    const command = '/create_bot';
    logger.info({ userId, command }, '🎯 Команда /create_bot получена');
    try {
      if (ctx.scene) {
        await handleCreateBot(ctx as Scenes.SceneContext);
      } else {
        logger.warn({ userId, command }, 'Сцены не инициализированы');
        ctx.reply('❌ Сцены не инициализированы.').catch((error) => {
          logger.error({ userId, command, error }, 'Failed to send scene initialization error');
        });
      }
    } catch (error) {
      logger.error({ userId, command, error }, 'Error in /create_bot command:');
      ctx.reply('❌ Произошла ошибка при обработке команды.').catch((replyError) => {
        logger.error({ userId, command, error: replyError }, 'Failed to send error message');
      });
    }
  });
  
  botInstance.command('my_bots', async (ctx) => {
    const userId = ctx.from?.id;
    const command = '/my_bots';
    logger.info({ userId, command }, '🎯 Команда /my_bots получена');
    try {
      await handleMyBots(ctx as any);
    } catch (error) {
      logger.error({ userId, command, error }, 'Error in /my_bots command:');
      ctx.reply('❌ Произошла ошибка при обработке команды.').catch((replyError) => {
        logger.error({ userId, command, error: replyError }, 'Failed to send error message');
      });
    }
  });
  
  botInstance.command('help', async (ctx) => {
    const userId = ctx.from?.id;
    const command = '/help';
    logger.info({ userId, command }, '🎯 Команда /help получена');
    try {
      await handleHelp(ctx as any);
    } catch (error) {
      logger.error({ userId, command, error }, 'Error in /help command:');
      ctx.reply('❌ Произошла ошибка при обработке команды.').catch((replyError) => {
        logger.error({ userId, command, error: replyError }, 'Failed to send error message');
      });
    }
  });
  
  // Обработка callback_query (кнопки)
  botInstance.action('back_to_menu', async (ctx) => {
    const userId = ctx.from?.id;
    const command = 'back_to_menu';
    try {
      await ctx.answerCbQuery();
      await handleStart(ctx as any);
      logger.info({ userId, command }, '✅ Возврат в главное меню');
    } catch (error) {
      logger.error({ userId, command, error }, 'Error handling back_to_menu:');
      ctx.answerCbQuery('Ошибка при возврате в меню').catch((replyError) => {
        logger.error(
          { userId, command, error: replyError },
          'Failed to answer callback query'
        );
      });
    }
  });
  
  botInstance.action('create_bot', async (ctx) => {
    const userId = ctx.from?.id;
    const command = 'create_bot';
    try {
      await ctx.answerCbQuery();
      if (ctx.scene) {
        await handleCreateBot(ctx as Scenes.SceneContext);
      } else {
        logger.warn({ userId, command }, 'Сцены не инициализированы');
        await ctx.reply('❌ Сцены не инициализированы.');
      }
    } catch (error) {
      logger.error({ userId, command, error }, 'Error handling create_bot action:');
      ctx.answerCbQuery('Ошибка').catch((replyError) => {
        logger.error(
          { userId, command, error: replyError },
          'Failed to answer callback query'
        );
      });
    }
  });
  
  botInstance.action('my_bots', async (ctx) => {
    const userId = ctx.from?.id;
    const command = 'my_bots';
    try {
      await ctx.answerCbQuery();
      await handleMyBots(ctx as any);
    } catch (error) {
      logger.error({ userId, command, error }, 'Error handling my_bots action:');
      ctx.answerCbQuery('Ошибка').catch((replyError) => {
        logger.error(
          { userId, command, error: replyError },
          'Failed to answer callback query'
        );
      });
    }
  });
  
  botInstance.action('help', async (ctx) => {
    const userId = ctx.from?.id;
    const command = 'help';
    try {
      await ctx.answerCbQuery();
      await handleHelp(ctx as any);
    } catch (error) {
      logger.error({ userId, command, error }, 'Error handling help action:');
      ctx.answerCbQuery('Ошибка').catch((replyError) => {
        logger.error(
          { userId, command, error: replyError },
          'Failed to answer callback query'
        );
      });
    }
  });

  // Команда для настройки webhook основного бота
  botInstance.command('setup_webhook', async (ctx) => {
    const userId = ctx.from?.id;
    const command = '/setup_webhook';
    logger.info({ userId, command }, '🎯 Команда /setup_webhook получена');
    try {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        await ctx.reply('❌ TELEGRAM_BOT_TOKEN не установлен в переменных окружения.');
        return;
      }

      // Проверка прав доступа
      // Уточнение (компромиссный режим): если `ADMIN_USER_IDS` не задан/пустой,
      // не блокируйте команду полностью. Либо разрешите выполнение с явным предупреждением,
      // либо применяйте настройку только для текущего чата (chat_id = ctx.chat.id) и сообщайте об этом.
      const adminUserIds = (process.env.ADMIN_USER_IDS || '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id));
      const userId = ctx.from?.id;

      const isAllowlistConfigured = adminUserIds.length > 0;

      if (isAllowlistConfigured && (!userId || !adminUserIds.includes(userId))) {
        await ctx.reply('🛑 Недостаточно прав');
        return;
      }

      const apiUrl = process.env.API_URL || 'https://lego-bot-core.vercel.app';
      const webhookUrl = `${apiUrl}/api/webhook`;
      const secretToken = process.env.TELEGRAM_SECRET_TOKEN;
      
      logger.info({ userId, command, webhookUrl }, '🔗 Setting webhook to');
      logger.info({ userId, command, secretTokenSet: Boolean(secretToken) }, '🔒 Secret token');

      const { setWebhook } = await import('./services/telegram-webhook');
      const result = await setWebhook(botToken, webhookUrl, secretToken, ['message', 'callback_query']);

      if (result.ok) {
        await ctx.reply(
          `✅ <b>Webhook для основного бота настроен!</b>\n\n` +
          `🔗 URL: <code>${webhookUrl}</code>\n` +
          `🔒 Secret Token: ${secretToken ? '✅ Установлен' : '⚠️ Не установлен'}\n\n` +
          `Теперь бот будет работать на Vercel.\n\n` +
          (secretToken ? '' : '⚠️ Рекомендуется установить TELEGRAM_SECRET_TOKEN для безопасности.'),
          { parse_mode: 'HTML' }
        );
        logger.info({ userId, command, webhookUrl }, '✅ Main bot webhook configured');
      } else {
        throw new Error(result.description || 'Unknown error');
      }
    } catch (error) {
      logger.error({ userId, command, error }, 'Error setting main bot webhook:');
      await ctx.reply(
        `❌ Ошибка настройки webhook: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { parse_mode: 'HTML' }
      );
    }
  });

  botInstance.command('setup_miniapp', async (ctx) => {
    const userId = ctx.from?.id;
    const command = '/setup_miniapp';
    logger.info({ userId, command }, '🎯 Команда /setup_miniapp получена');
    try {
      await handleSetupMiniApp(ctx as any);
    } catch (error) {
      logger.error({ userId, command, error }, 'Error in /setup_miniapp command:');
      ctx.reply('❌ Произошла ошибка при настройке Mini App.').catch((replyError) => {
        logger.error({ userId, command, error: replyError }, 'Failed to send error message');
      });
    }
  });

  botInstance.command('check_webhook', async (ctx) => {
    const userId = ctx.from?.id;
    const command = '/check_webhook';
    logger.info({ userId, command }, '🎯 Команда /check_webhook получена');
    try {
      await handleCheckWebhook(ctx as any);
    } catch (error) {
      logger.error({ userId, command, error }, 'Error in /check_webhook command:');
      ctx.reply('❌ Произошла ошибка при проверке webhook.').catch((replyError) => {
        logger.error({ userId, command, error: replyError }, 'Failed to send error message');
      });
    }
  });

  // Команда /setwebhook <bot_id>
  botInstance.command('setwebhook', async (ctx) => {
    const userId = ctx.from?.id;
    const command = '/setwebhook';
    logger.info({ userId, command }, '🎯 Команда /setwebhook получена');
    try {
      const message = ctx.message;
      if (!('text' in message)) return;
      
      const parts = message.text.split(' ');
      const botId = parts[1]; // Второй аргумент после команды
      
      await handleSetWebhook(ctx as any, botId);
      logger.info({ userId, command, botId }, '✅ Webhook setup completed');
    } catch (error) {
      const message = ctx.message;
      const botId = message && 'text' in message ? message.text.split(' ')[1] : undefined;
      logger.error(
        { userId, command, botId, error, metric: 'webhook_setup_error' },
        'Error in /setwebhook command:'
      );
      ctx.reply('❌ Произошла ошибка при обработке команды.').catch((replyError) => {
        logger.error(
          { userId, command, botId, error: replyError },
          'Failed to send error message'
        );
      });
    }
  });

  // Команда /deletewebhook <bot_id>
  botInstance.command('deletewebhook', async (ctx) => {
    const userId = ctx.from?.id;
    const command = '/deletewebhook';
    logger.info({ userId, command }, '🎯 Команда /deletewebhook получена');
    try {
      const message = ctx.message;
      if (!('text' in message)) return;
      
      const parts = message.text.split(' ');
      const botId = parts[1]; // Второй аргумент после команды
      
      await handleDeleteWebhook(ctx as any, botId);
      logger.info({ userId, command, botId }, '✅ Webhook deleted');
    } catch (error) {
      const message = ctx.message;
      const botId = message && 'text' in message ? message.text.split(' ')[1] : undefined;
      logger.error({ userId, command, botId, error }, 'Error in /deletewebhook command:');
      ctx.reply('❌ Произошла ошибка при обработке команды.').catch((replyError) => {
        logger.error(
          { userId, command, botId, error: replyError },
          'Failed to send error message'
        );
      });
    }
  });

  // Команда /editschema <bot_id> <json>
  botInstance.command('editschema', async (ctx) => {
    const userId = ctx.from?.id;
    const command = '/editschema';
    logger.info({ userId, command }, '🎯 Команда /editschema получена');
    try {
      const message = ctx.message;
      if (!('text' in message)) return;
      
      const text = message.text;
      // Разделяем команду и аргументы
      // Формат: /editschema <bot_id> <json>
      const parts = text.split(' ');
      if (parts.length < 3) {
        await handleEditSchema(ctx as any);
        return;
      }
      
      const botId = parts[1];
      // JSON может содержать пробелы, берем все после bot_id
      const jsonStart = text.indexOf(botId) + botId.length + 1;
      const schemaJson = text.substring(jsonStart).trim();
      
      await handleEditSchema(ctx as any, botId, schemaJson);
      logger.info({ userId, command, botId }, '✅ Schema edit handled');
    } catch (error) {
      logger.error({ userId, command, error }, 'Error in /editschema command:');
      ctx.reply('❌ Произошла ошибка при обработке команды.').catch((replyError) => {
        logger.error({ userId, command, error: replyError }, 'Failed to send error message');
      });
    }
  });
  
  // Обработка ошибок
  botInstance.catch((err, ctx) => {
    const userId = ctx.from?.id;
    logger.error({ userId, error: err }, 'Error in bot:');
    ctx.reply('❌ Произошла ошибка. Попробуйте позже.').catch((replyError) => {
      logger.error({ userId, error: replyError }, 'Failed to send error message');
    });
  });
  

  // Запуск бота через long polling (только локально, не на Vercel)
  if (process.env.VERCEL !== '1') {
    botInstance.launch({
      allowedUpdates: ['message', 'callback_query'],
      dropPendingUpdates: false,
    }).then(() => {
      logger.info('✅ Telegram bot started successfully (long polling)');
      logger.info('✅ Бот готов к работе');
      botInstance?.telegram.getMe().then((botInfo) => {
        logger.info(
          { id: botInfo.id, username: botInfo.username, firstName: botInfo.first_name },
          '🤖 Bot info:'
        );
        logger.info('💡 Отправьте боту /start для проверки');
      }).catch((error) => {
        logger.error({ error }, 'Failed to fetch bot info');
      });
    }).catch((error) => {
      logger.error({ error }, '❌ Failed to launch bot:');
      logger.error('Проверьте:');
      logger.error('1. Правильность токена в .env файле');
      logger.error('2. Подключение к интернету');
      logger.error('3. Доступность Telegram API');
    });
  } else {
    logger.info('🔗 Bot configured for webhook mode (Vercel serverless)');
    logger.info('📡 Webhook endpoint: /api/webhook');
    logger.info('⚠️  Не забудьте настроить webhook через Telegram API');
    logger.info('💡 Используйте: https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://lego-bot-core.vercel.app/api/webhook');
  }
}

app.use(errorMetricsMiddleware as any);
app.use((err: any, req: Request, res: Response, next: Function) => {
  const requestId = getRequestId() ?? (req as any)?.id ?? 'unknown';
  const userId = (req as any).user?.id;
  const errorContext = {
    requestId,
    method: req.method,
    path: req.path,
    userId,
    error: {
      name: err?.name,
      message: err?.message,
      stack: err?.stack,
      code: err?.code,
    },
  };

  logger.error(errorContext, 'Unhandled error');

  const statusCode = err?.statusCode || err?.status || 500;
  const message =
    process.env.NODE_ENV === 'production'
      ? 'An error occurred'
      : err instanceof Error
        ? err.message
        : String(err);

  res.status(statusCode).json({
    error: 'Internal server error',
    message,
    requestId,
    timestamp: new Date().toISOString(),
  });
});
}

// Start server (only in non-serverless environment)
async function startServer() {
  if (process.env.VERCEL === '1') {
    return;
  }

  await initializeDatabases();
  await initializeRateLimiters();

  const appInstance = createApp();
  appInstance.listen(PORT, () => {
    logger.info(`Server is running on port ${PORT}`);
  });
}

if (process.env.NODE_ENV !== 'test') {
  startServer().catch((error) => {
    logger.error({ error }, 'Failed to start server');
  });
}

// Export app for Vercel serverless functions
const appInstance = createApp();
export default appInstance;
module.exports = appInstance; // Also export as CommonJS for compatibility

// Export botInstance for webhook endpoint
export { botInstance };
if (typeof module !== 'undefined') {
  (module.exports as any).botInstance = botInstance;
}

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down gracefully...');
  
  if (botInstance) {
    await botInstance.stop('SIGTERM');
  }
  
  await closePostgres();
  await closeRedis();
  
  process.exit(0);
}

process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled Promise Rejection');
});

process.on('uncaughtException', (error) => {
  logger.fatal({ error }, 'Uncaught Exception');
  shutdown().catch((shutdownError) => {
    logger.error({ error: shutdownError }, 'Graceful shutdown failed');
    process.exit(1);
  });
});

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);








