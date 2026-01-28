/**
 * Router Service - Webhook роутер для созданных ботов
 * 
 * Функциональность:
 * - Принимает webhook от Telegram на /webhook/:botId
 * - Загружает схему бота из PostgreSQL
 * - Определяет состояние пользователя из Redis
 * - Отправляет сообщения и кнопки согласно схеме
 */

import 'express-async-errors';
import express, { Request, Response, NextFunction } from 'express';
import type { Server } from 'http';
import dotenv from 'dotenv';
import path from 'path';
import pinoHttp from 'pino-http';
import { RATE_LIMITS, TelegramUpdateSchema, WEBHOOK_INTEGRATION_LIMITS, WEBHOOK_LIMITS, createChildLogger, createLogger, createRateLimiter, errorMetricsMiddleware, getCacheMetrics, getErrorMetrics, logRateLimitMetrics, metricsMiddleware, requestIdMiddleware } from '@dialogue-constructor/shared';
import { initPostgres, getBotById, closePostgres, getBotSchema, getPoolStats, getPostgresCircuitBreakerStats, getPostgresRetryStats, getPostgresClient } from './db/postgres';
import { initRedis, closeRedis, getUserState, setUserState, getRedisClientOptional, getRedisCircuitBreakerStats, getRedisRetryStats, getInMemoryStateStats, setPendingInput, getPendingInput, clearPendingInput, markBroadcastUpdateProcessed } from './db/redis';
import { decryptToken } from './utils/encryption';
import { sendTelegramMessage, sendTelegramMessageWithKeyboard, sendTelegramMessageWithReplyKeyboard, sendTelegramMessageWithReplyKeyboardRemove, sendPhoto, sendVideo, sendDocument, sendAudio, sendMediaGroup, answerCallbackQuery, TelegramUpdate } from './services/telegram';
import type { BotButton, BotSchema, RequestContactButton, RequestEmailButton } from '@dialogue-constructor/shared/types/bot-schema';
import * as crypto from 'crypto';
import { createOrUpdateBotUser, getBotUserProfile } from './db/bot-users';
import { createWebhookLog } from './db/webhook-logs';
import { logAnalyticsEvent } from './db/bot-analytics';
import { findBroadcastMessageIdByTelegramMessage, findLatestSentBroadcastMessageId, incrementBroadcastMessageClicks, markBroadcastMessageEngaged } from './db/broadcasts';
import { prepareWebhookPayload, sendWebhook, sendWebhookWithRetry } from './services/webhook-sender';
import { sendToGoogleSheets } from './services/integrations/google-sheets';
import { sendToTelegramChannel } from './services/integrations/telegram-channel';

// Загрузка .env файла из корня проекта
const envPath = path.resolve(__dirname, '../../../.env');
dotenv.config({ path: envPath });
const logger = createLogger('router');
logger.info({ path: envPath }, '📄 Загрузка .env из:');

let app: ReturnType<typeof express> | null = null;
let appInitialized = false;
// Router должен использовать ROUTER_PORT, чтобы не конфликтовать с core (PORT=3000)
const PORT = process.env.ROUTER_PORT || 3001;
let server: Server | null = null;
const BOT_ID_FORMAT_REGEX = /^[0-9a-fA-F-]{36}$/;
const BROADCAST_ENGAGEMENT_WINDOW_MS = 24 * 60 * 60 * 1000;

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

// Инициализация PostgreSQL
async function startServer() {
  logger.info({ port: PORT }, 'Запуск сервера роутера');
  try {
    await initPostgres(logger);
    logger.info('✅ PostgreSQL pool initialized');
  } catch (error) {
    logger.error({ error }, '❌ Failed to initialize PostgreSQL:');
    if (process.env.VERCEL !== '1') {
      process.exit(1);
    }
    if (process.env.VERCEL === '1') {
      logger.warn('⚠️ PostgreSQL initialization failed, continuing without exit');
    }
  }

  try {
    const redisClient = await initRedis(logger);
    if (redisClient) {
      logger.info('✅ Redis initialized');
    } else {
      logger.warn('⚠️ Redis initialization failed, continuing without cache');
    }
    rateLimiterRedisClient = redisClient;
  } catch (error) {
    logger.warn({ error }, '⚠️ Redis initialization failed, continuing without cache:');
  }

  await initializeRateLimiters().catch((error) => {
    logger.warn({ error }, 'Rate limiter initialization failed, continuing without exit');
  });
  void prewarmConnections();

  const appInstance = createApp();
  server = appInstance.listen(PORT, () => {
    logger.info(`🚀 Сервер роутера запущен на порту ${PORT}`);
    logger.info(`🔗 Webhook endpoint: http://localhost:${PORT}/webhook/:botId`);
  });
}

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

let webhookPerBotLimiter: ReturnType<typeof createRateLimiter> | null = null;
let webhookGlobalLimiter: ReturnType<typeof createRateLimiter> | null = null;
let rateLimiterRedisClient: Awaited<ReturnType<typeof initRedis>> | null = null;
let rateLimiterInitPromise: Promise<void> | null = null;

async function initializeRateLimiters() {
  if (webhookPerBotLimiter && webhookGlobalLimiter) {
    return;
  }
  if (!rateLimiterInitPromise) {
    rateLimiterInitPromise = (async () => {
      try {
        const redisClientOptional = rateLimiterRedisClient ?? await getRedisClientOptional();
        if (redisClientOptional) {
          logger.info({ rateLimiting: { backend: 'redis' } }, 'Rate limiting backend initialized');
        }
        webhookPerBotLimiter = createRateLimiter(
          redisClientOptional,
          logger,
          {
            ...RATE_LIMITS.WEBHOOK_PER_BOT,
            keyGenerator: (req) => {
              const botId = req.params?.botId;
              if (typeof botId !== 'string' || !BOT_ID_FORMAT_REGEX.test(botId)) {
                return 'bot:invalid';
              }
              return `bot:${botId}`;
            },
          }
        );
        webhookGlobalLimiter = createRateLimiter(
          redisClientOptional,
          logger,
          RATE_LIMITS.WEBHOOK_GLOBAL
        );
      } catch (error) {
        rateLimiterInitPromise = null;
        logger.warn({ error }, 'Rate limiter initialization failed, continuing without exit');
      }
    })();
  }
  return rateLimiterInitPromise;
}

export { initializeRateLimiters };

const webhookGlobalLimiterMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!webhookGlobalLimiter) {
      await initializeRateLimiters();
    }
    if (webhookGlobalLimiter) {
      return webhookGlobalLimiter(req, res, next);
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

const webhookBotIdFormatMiddleware = (req: Request, _res: Response, next: NextFunction) => {
  const botId = req.params?.botId;
  (req as any).botIdFormatValid = typeof botId === 'string' && BOT_ID_FORMAT_REGEX.test(botId);
  next();
};

const webhookPerBotLimiterMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!webhookPerBotLimiter) {
      await initializeRateLimiters();
    }
    if (webhookPerBotLimiter) {
      return webhookPerBotLimiter(req, res, next);
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

function configureApp(app: ReturnType<typeof express>) {
// Middleware
app.use(express.json({ limit: WEBHOOK_LIMITS.MAX_PAYLOAD_SIZE }));
app.use(express.urlencoded({ extended: true }));
app.use(requestIdMiddleware());
app.use(pinoHttp({ logger }));
app.use(metricsMiddleware(logger));

// Middleware для проверки размера payload
// Примечание: `content-length` может отсутствовать/быть неверным. Помимо проверки заголовка,
// ограничьте парсер/маршрут: например `express.json({ limit: '1mb' })` (или `express.raw({ limit: '1mb' })`) на webhook-маршруте.
app.use('/webhook/:botId', (req, res, next) => {
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > WEBHOOK_LIMITS.MAX_PAYLOAD_SIZE) {
    logger.warn({ botId: req.params.botId, contentLength }, 'Webhook payload too large');
    return res.status(413).json({ error: 'Payload too large' });
  }
  next();
});

app.use(logRateLimitMetrics(logger));

// Health check
app.get('/health', async (req: Request, res: Response) => {
  let postgresState: 'ready' | 'error' = 'error';
  let redisState: 'ready' | 'error' = 'error';

  const postgresCircuitBreaker = getPostgresCircuitBreakerStats();
  const redisCircuitBreaker = getRedisCircuitBreakerStats();
  const poolStats = getPoolStats();
  const retryStats = {
    postgres: getPostgresRetryStats(),
    redis: getRedisRetryStats(),
  };
  const errorMetrics = getErrorMetrics();
  const inMemoryStates = getInMemoryStateStats();

  try {
    const { getPostgresClient } = await import('./db/postgres');
    const client = await getPostgresClient();
    await client.query('SELECT 1');
    client.release();
    postgresState = 'ready';
  } catch (error) {
    postgresState = 'error';
  }

  try {
    const redisClient = await getRedisClientOptional();
    if (redisClient) {
      await redisClient.ping();
      redisState = 'ready';
    } else {
      redisState = 'error';
    }
  } catch (error) {
    redisState = 'error';
  }

  const postgresBreakerOpen = postgresCircuitBreaker.state !== 'closed';
  const redisBreakerOpen = redisCircuitBreaker.state !== 'closed';
  const status = postgresState === 'ready' && !postgresBreakerOpen
    ? (redisState === 'ready' && !redisBreakerOpen ? 'ok' : 'degraded')
    : 'error';
  const statusCode = status === 'error' ? 503 : 200;
  const requestId = (req as any).id;
  logger.info(
    {
      requestId,
      status,
      databases: {
        postgres: postgresState,
        redis: redisState,
      },
    },
    'Health check'
  );

  res.status(statusCode).json({
    status,
    degraded: status === 'degraded',
    timestamp: new Date().toISOString(),
    service: 'router',
    databases: {
      postgres: postgresState,
      redis: redisState,
    },
    circuitBreakers: {
      postgres: postgresCircuitBreaker,
      redis: redisCircuitBreaker,
    },
    connectionPool: {
      postgres: {
        total: poolStats.totalCount,
        idle: poolStats.idleCount,
        waiting: poolStats.waitingCount,
      },
    },
    inMemoryStates,
    cacheMetrics: getCacheMetrics(),
    retryStats,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    errorMetrics,
    rateLimiting: {
      enabled: redisState === 'ready',
      backend: redisState === 'ready' ? 'redis' : 'memory',
    },
  });
});


// Internal webhook test endpoint
app.post('/internal/test-webhook', async (req: Request, res: Response) => {
  const requestId = (req as any).id;
  const internalSecret = process.env.ROUTER_INTERNAL_SECRET;
  if (internalSecret) {
    const providedSecretHeader = req.headers['x-internal-secret'];
    const providedSecret = Array.isArray(providedSecretHeader)
      ? providedSecretHeader[0]
      : providedSecretHeader;
    if (!providedSecret || providedSecret !== internalSecret) {
      logger.warn({ requestId }, 'Unauthorized internal webhook test request');
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const { webhook, payload } = req.body ?? {};
  if (!webhook || typeof webhook !== 'object') {
    return res.status(400).json({ error: 'Invalid webhook config' });
  }
  if (!('url' in webhook) || typeof (webhook as any).url !== 'string') {
    return res.status(400).json({ error: 'Invalid webhook url' });
  }

  const timeout = typeof (webhook as any).timeout === 'number'
    ? Math.min((webhook as any).timeout, WEBHOOK_INTEGRATION_LIMITS.AWAIT_FIRST_ATTEMPT_TIMEOUT_MS)
    : WEBHOOK_INTEGRATION_LIMITS.AWAIT_FIRST_ATTEMPT_TIMEOUT_MS;

  try {
    const result = await sendWebhook(
      { ...(webhook as any), timeout },
      payload ?? {},
      logger
    );
    return res.json({
      success: !result.error,
      status: result.status ?? null,
      response: result.response ?? null,
      error: result.error ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ requestId, error }, 'Internal webhook test failed');
    return res.status(200).json({ success: false, status: null, response: null, error: message });
  }
});
// Webhook endpoint
app.post('/webhook/:botId',
  webhookGlobalLimiterMiddleware,
  webhookBotIdFormatMiddleware,
  webhookPerBotLimiterMiddleware,
  async (req: Request, res: Response) => {
  const { botId } = req.params;
  const requestId = (req as any).id;
  const startTime = Date.now();

  const updateValidation = TelegramUpdateSchema.safeParse(req.body);
  if (!updateValidation.success) {
    logger.warn({ botId, requestId, errors: updateValidation.error.issues }, 'Invalid Telegram update');
    logger.info({ metric: 'webhook_error', botId, requestId, updateType: 'invalid_update' }, 'Webhook error');
    return res.status(400).json({ error: 'Invalid update payload' });
  }

  const update: TelegramUpdate = updateValidation.data;
  const updateType = update.message ? 'message' : update.callback_query ? 'callback_query' : 'unknown';
  const userId = update.message?.from?.id ?? update.callback_query?.from?.id ?? null;
  logger.info({ botId, userId, updateType, requestId }, 'Webhook received');

  try {
    // Валидация botId
    const botIdFormatValid = (req as any).botIdFormatValid
      ?? (typeof botId === 'string' && BOT_ID_FORMAT_REGEX.test(botId));
    if (!botId || typeof botId !== 'string' || !botIdFormatValid) {
      logger.error({ botId, requestId }, '❌ Invalid botId:');
      logger.info({ metric: 'webhook_error', botId, userId, updateType, requestId }, 'Webhook error');
      return res.status(400).json({ error: 'Invalid botId' });
    }

    // Валидация webhook secret token из заголовков
    // Уточнение: заголовок может быть `string | string[] | undefined`. Нормализуем безопасно:
    // - если массив -> взять первый элемент; если отсутствует -> 401.
    const webhookSecretHeader = req.headers['x-telegram-bot-api-secret-token'];
    const webhookSecret = Array.isArray(webhookSecretHeader) ? webhookSecretHeader[0] : webhookSecretHeader;
    
    if (!webhookSecret) {
      logger.warn({ botId, requestId }, 'Missing webhook secret token');
      logger.info({ metric: 'webhook_error', botId, userId, updateType, requestId }, 'Webhook error');
      return res.status(401).json({ error: 'Unauthorized: Missing secret token' });
    }

    // Получаем бота из базы данных
    const bot = await getBotById(botId);
    if (!bot) {
      logger.error({ botId, requestId }, '❌ Bot not found');
      logger.info({ metric: 'webhook_error', botId, userId, updateType, requestId }, 'Webhook error');
      return res.status(404).json({ error: 'Bot not found' });
    }

    // Проверка webhook secret
    if (!bot.webhook_secret) {
      logger.warn({ botId, requestId }, 'Missing webhook secret token');
      logger.info({ metric: 'webhook_error', botId, userId, updateType: 'unauthorized', requestId }, 'Webhook unauthorized');
      return res.status(401).json({ error: 'Unauthorized: Invalid secret token' });
    }

    const expectedBuffer = Buffer.from(bot.webhook_secret);
    const actualBuffer = Buffer.from(webhookSecret);
    if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
      logger.warn({ botId, requestId }, 'Invalid webhook secret token');
      logger.info({ metric: 'webhook_error', botId, userId, updateType: 'unauthorized', requestId }, 'Webhook unauthorized');
      return res.status(401).json({ error: 'Unauthorized: Invalid secret token' });
    }

    logger.info({ botId: bot.id, botName: bot.name, requestId }, '✅ Bot found');

    // Расшифровываем токен
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      logger.error({ botId, requestId }, '❌ ENCRYPTION_KEY is not set');
      logger.info({ metric: 'webhook_error', botId, userId, updateType, requestId }, 'Webhook error');
      return res.status(500).json({ error: 'Encryption key not configured' });
    }

    let decryptedToken: string;
    try {
      decryptedToken = decryptToken(bot.token, encryptionKey);
      logger.info({ botId, botName: bot.name, requestId }, '✅ Token decrypted for bot');
    } catch (error) {
      logger.error({ botId, requestId, error }, '❌ Failed to decrypt token:');
      logger.info({ metric: 'webhook_error', botId, userId, updateType, requestId }, 'Webhook error');
      return res.status(500).json({ error: 'Failed to decrypt bot token' });
    }

    // Получаем схему бота
    const schema = await getBotSchema(botId, logger);
    
    if (!schema) {
      // Если схема не настроена, отправляем стандартный ответ
      if (update.message) {
        const chatId = update.message.chat.id;
        const messageText = update.message.text || '';
        
        logger.info({
          botId,
          userId,
          requestId,
          chatId,
          textPreview: messageText.substring(0, 50),
        }, '💬 Message received without schema');
        logger.warn({ botId, requestId }, '⚠️  Schema not configured for bot');

        const responseText = 'Привет! Я бот, созданный через конструктор.\n\nСхема диалогов еще не настроена. Используйте команду /editschema для настройки.';
        
        try {
          await sendTelegramMessage(logger, decryptedToken, chatId, responseText);
          logger.info({ botId, chatId, requestId }, '✅ Message sent to chat');
        } catch (error) {
          logger.error(
            { botId, chatId, requestId, error, metric: 'telegram_send_error' },
            '❌ Failed to send message:'
          );
        }
      }
    } else {
      // Обработка с использованием схемы
      await handleUpdateWithSchema(update, botId, schema, decryptedToken, requestId);
    }

    // Всегда возвращаем 200 OK для Telegram
    logger.info(
      { metric: 'webhook_processing', botId, userId, duration: Date.now() - startTime, requestId },
      'Webhook processed'
    );
    logger.info(
      { metric: 'bot_messages_processed', botId, userId, count: 1, requestId },
      'Bot message processed'
    );
    res.status(200).json({ status: 'ok' });

  } catch (error) {
    logger.error({ botId, requestId, error }, '❌ Error processing webhook:');
    logger.info({ metric: 'webhook_error', botId, userId, updateType, requestId }, 'Webhook error');
    // Возвращаем 200 OK, чтобы Telegram не повторял запрос
    res.status(200).json({ 
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Обработка обновления с использованием схемы
 */
async function handleUpdateWithSchema(
  update: TelegramUpdate,
  botId: string,
  schema: BotSchema,
  botToken: string,
  requestId?: string
): Promise<void> {
  // Обработка callback_query (нажатие на кнопку)
  if (update.callback_query) {
    const chatId = update.callback_query.message?.chat.id;
    const userId = update.callback_query.from.id;
    const rawCallbackData = update.callback_query.data;
    const callbackQueryId = update.callback_query.id;
    const requestLogger = createChildLogger(logger, { botId, userId, requestId });

    if (!chatId || !userId || !rawCallbackData) {
      requestLogger.error({ botId, userId, requestId }, '❌ Missing data in callback_query');
      return;
    }

    let callbackData = rawCallbackData;
    let broadcastMessageIdFromCallback: string | null = null;
    if (rawCallbackData.startsWith('broadcast:')) {
      const parts = rawCallbackData.split(':');
      broadcastMessageIdFromCallback = parts[1] || null;
      callbackData = parts.slice(2).join(':') || rawCallbackData;
    }

    requestLogger.info('Обработка webhook');
    requestLogger.info({ botId, userId, requestId, callbackData }, '🔘 Callback from user');
    requestLogger.debug({ botId, userId, currentState: callbackData }, 'Processing update');

    try {
      const shouldCount = await markBroadcastUpdateProcessed(botId, update.update_id);
      if (shouldCount) {
        let broadcastMessageId: string | null = null;
        const telegramMessageId = update.callback_query.message?.message_id;
        if (telegramMessageId) {
          broadcastMessageId = await findBroadcastMessageIdByTelegramMessage(
            botId,
            userId,
            telegramMessageId
          );
        }
        if (!broadcastMessageId && broadcastMessageIdFromCallback) {
          broadcastMessageId = broadcastMessageIdFromCallback;
        }
        if (!broadcastMessageId) {
          broadcastMessageId = await findLatestSentBroadcastMessageId(
            botId,
            userId,
            new Date(Date.now() - BROADCAST_ENGAGEMENT_WINDOW_MS)
          );
          if (broadcastMessageId) {
            requestLogger.info({ broadcastMessageId }, 'Broadcast click attributed via fallback window');
          }
        }
        if (broadcastMessageId) {
          await incrementBroadcastMessageClicks(broadcastMessageId);
          await markBroadcastMessageEngaged(broadcastMessageId);
        }
      }
    } catch (error) {
      requestLogger.warn({ error }, 'Failed to track broadcast click/engagement');
    }

    // Проверяем, что состояние существует в схеме
    if (!schema.states[callbackData]) {
      requestLogger.error(
        { botId, userId, requestId, stateKey: callbackData },
        '❌ State not found in schema'
      );
      try {
        await answerCallbackQuery(logger, botToken, callbackQueryId, 'Session expired, try again');
      } catch (error) {
        requestLogger.error({ botId, userId, requestId, error }, 'Failed to answer callback query');
      }
      return;
    }

    const previousState = await getUserState(botId, userId);
    const nextState = callbackData;
    const sourceUpdateId = update.update_id;

    try {
      await logAnalyticsEvent(
        botId,
        userId,
        sourceUpdateId,
        'button_click',
        {
          stateFrom: previousState ?? null,
          stateTo: nextState ?? null,
          buttonText: callbackData,
        },
        requestLogger
      );
    } catch (error) {
      requestLogger.warn({ error }, 'Failed to log button click analytics');
    }

    if (nextState && nextState !== previousState) {
      try {
        await logAnalyticsEvent(
          botId,
          userId,
          sourceUpdateId,
          'state_transition',
          {
            stateFrom: previousState ?? null,
            stateTo: nextState,
            buttonText: callbackData,
          },
          requestLogger
        );
      } catch (error) {
        requestLogger.warn({ error }, 'Failed to log state transition analytics');
      }
    }
    // Обновляем состояние пользователя
    await setUserState(botId, userId, callbackData);

    // Отправляем сообщение и кнопки для нового состояния
    await sendStateMessage(
      botToken,
      chatId,
      callbackData,
      schema,
      requestLogger,
      botId,
      userId,
      previousState
    );

    // Отвечаем на callback
    try {
      await answerCallbackQuery(logger, botToken, callbackQueryId);
    } catch (error) {
      requestLogger.error({ botId, userId, requestId, error }, 'Failed to answer callback query');
    }

    return;
  }

  // Обработка обычного сообщения
  if (update.message) {
    const chatId = update.message.chat.id;
    const userId = update.message.from?.id;
    const messageText = update.message.text || '';
    const requestLogger = createChildLogger(logger, { botId, userId, requestId });

    if (!userId) {
      requestLogger.error({ botId, requestId }, '❌ User ID not found in message');
      return;
    }

    const profileFields = {
      first_name: update.message.from?.first_name ?? null,
      last_name: update.message.from?.last_name ?? null,
      username: update.message.from?.username ?? null,
      language_code: update.message.from?.language_code ?? null,
    };

    requestLogger.info('Обработка webhook');
    requestLogger.info(
      { botId, userId, requestId, chatId, textPreview: messageText.substring(0, 50) },
      '💬 Message from user'
    );

    try {
      const shouldCount = await markBroadcastUpdateProcessed(botId, update.update_id);
      if (shouldCount) {
        let broadcastMessageId: string | null = null;
        const replyToMessageId = update.message.reply_to_message?.message_id;
        if (replyToMessageId) {
          broadcastMessageId = await findBroadcastMessageIdByTelegramMessage(
            botId,
            userId,
            replyToMessageId
          );
        }
        if (!broadcastMessageId) {
          broadcastMessageId = await findLatestSentBroadcastMessageId(
            botId,
            userId,
            new Date(Date.now() - BROADCAST_ENGAGEMENT_WINDOW_MS)
          );
          if (broadcastMessageId) {
            requestLogger.info({ broadcastMessageId }, 'Broadcast engagement attributed via fallback window');
          }
        }
        if (broadcastMessageId) {
          await markBroadcastMessageEngaged(broadcastMessageId);
        }
      }
    } catch (error) {
      requestLogger.warn({ error }, 'Failed to track broadcast engagement');
    }

    if (update.message.contact) {
      const contact = update.message.contact;
      const pending = await getPendingInput(botId, userId);
      const contactMatchesUser = !contact.user_id || contact.user_id === userId;
      const phoneNumberToSave = pending?.type === 'contact' && contactMatchesUser
        ? contact.phone_number
        : null;

      const botUser = await createOrUpdateBotUser(
        botId,
        String(userId),
        { ...profileFields, phone_number: phoneNumberToSave },
        requestLogger
      );
      if (botUser?.interaction_count === 1) {
        try {
          await logAnalyticsEvent(
            botId,
            userId,
            update.update_id,
            'bot_start',
            {},
            requestLogger
          );
        } catch (error) {
          requestLogger.warn({ error }, 'Failed to log bot start analytics');
        }
      }

      if (!pending || pending.type !== 'contact') {
        requestLogger.warn({ botId, userId, requestId }, 'Pending contact not found');
        return;
      }

      if (!contactMatchesUser) {
        requestLogger.warn({ botId, userId, requestId }, 'Contact user mismatch');
        return;
      }

      requestLogger.info({ metric: 'contact_collected', botId, userId }, 'Contact collected');
      await clearPendingInput(botId, userId);
      try {
        await logAnalyticsEvent(
          botId,
          userId,
          update.update_id,
          'contact_shared',
          {
            stateFrom: pending.stateId ?? null,
            stateTo: pending.nextState ?? null,
          },
          requestLogger
        );
      } catch (error) {
        requestLogger.warn({ error }, 'Failed to log contact shared analytics');
      }

      await sendTelegramMessageWithReplyKeyboardRemove(
        requestLogger,
        botToken,
        chatId,
        'Спасибо! Ваш номер сохранён.'
      );

      if (pending.nextState && schema.states[pending.nextState]) {
        await setUserState(botId, userId, pending.nextState);
        await sendStateMessage(
          botToken,
          chatId,
          pending.nextState,
          schema,
          requestLogger,
          botId,
          userId,
          pending.stateId
        );
      }
      return;
    }

    if (typeof update.message.text === 'string') {
      const pending = await getPendingInput(botId, userId);
      if (pending && pending.type === 'email') {
        const rawEmail = update.message.text.trim();
        if (rawEmail.toLowerCase() === '/skip') {
          const botUser = await createOrUpdateBotUser(
            botId,
            String(userId),
            { ...profileFields, email: null },
            requestLogger
          );
          if (botUser?.interaction_count === 1) {
            try {
              await logAnalyticsEvent(
                botId,
                userId,
                update.update_id,
                'bot_start',
                {},
                requestLogger
              );
            } catch (error) {
              requestLogger.warn({ error }, 'Failed to log bot start analytics');
            }
          }
          await clearPendingInput(botId, userId);
          if (pending.nextState && schema.states[pending.nextState]) {
            await setUserState(botId, userId, pending.nextState);
            await sendStateMessage(
              botToken,
              chatId,
              pending.nextState,
              schema,
              requestLogger,
              botId,
              userId,
              pending.stateId
            );
          }
          return;
        }

        if (!isValidEmail(rawEmail)) {
          const botUser = await createOrUpdateBotUser(
            botId,
            String(userId),
            { ...profileFields, email: null },
            requestLogger
          );
          if (botUser?.interaction_count === 1) {
            try {
              await logAnalyticsEvent(
                botId,
                userId,
                update.update_id,
                'bot_start',
                {},
                requestLogger
              );
            } catch (error) {
              requestLogger.warn({ error }, 'Failed to log bot start analytics');
            }
          }
          await sendTelegramMessage(requestLogger, botToken, chatId, 'Введите корректный email.');
          return;
        }

        const botUser = await createOrUpdateBotUser(
          botId,
          String(userId),
          { ...profileFields, email: rawEmail },
          requestLogger
        );
        if (botUser?.interaction_count === 1) {
          try {
            await logAnalyticsEvent(
              botId,
              userId,
              update.update_id,
              'bot_start',
              {},
              requestLogger
            );
          } catch (error) {
            requestLogger.warn({ error }, 'Failed to log bot start analytics');
          }
        }
        await clearPendingInput(botId, userId);
        try {
          await logAnalyticsEvent(
            botId,
            userId,
            update.update_id,
            'email_shared',
            {
              stateFrom: pending.stateId ?? null,
              stateTo: pending.nextState ?? null,
            },
            requestLogger
          );
        } catch (error) {
          requestLogger.warn({ error }, 'Failed to log email shared analytics');
        }

        if (pending.nextState && schema.states[pending.nextState]) {
          await setUserState(botId, userId, pending.nextState);
          await sendStateMessage(
            botToken,
            chatId,
            pending.nextState,
            schema,
            requestLogger,
            botId,
            userId,
            pending.stateId
          );
        }
        return;
      }
    }

    const botUser = await createOrUpdateBotUser(
      botId,
      String(userId),
      { ...profileFields, phone_number: null },
      requestLogger
    );
    if (botUser?.interaction_count === 1) {
      try {
        await logAnalyticsEvent(
          botId,
          userId,
          update.update_id,
          'bot_start',
          {},
          requestLogger
        );
      } catch (error) {
        requestLogger.warn({ error }, 'Failed to log bot start analytics');
      }
    }

    // Получаем текущее состояние пользователя
    let currentState = await getUserState(botId, userId);

    // Если состояние не установлено или не существует, используем начальное
    if (!currentState || !schema.states[currentState]) {
      currentState = schema.initialState;
      await setUserState(botId, userId, currentState);
    }

    // Отправляем сообщение и кнопки для текущего состояния
    requestLogger.debug({ botId, userId, currentState }, 'Processing update');
    await sendStateMessage(
      botToken,
      chatId,
      currentState,
      schema,
      requestLogger,
      botId,
      userId,
      null
    );
  }
}

/**
 * Отправить сообщение и кнопки для состояния
 */
async function sendStateMessage(
  botToken: string,
  chatId: number,
  stateKey: string,
  schema: BotSchema,
  requestLogger: ReturnType<typeof createLogger>,
  botId: string,
  userId: number,
  previousState?: string | null
): Promise<void> {
  const state = schema.states[stateKey];
  
  if (!state) {
    requestLogger.error({ stateKey }, '❌ State not found in schema');
    return;
  }

  try {
    const parseMode = state.parseMode ?? 'HTML';
    const rawButtons = state.buttons ?? [];
    type NormalizedButton = BotButton & { type: 'navigation' | 'request_contact' | 'request_email' | 'url' };
    const normalizedButtons = rawButtons.map((button) => ({
      ...button,
      type: button.type ?? 'navigation',
    })) as NormalizedButton[];
    const requestContactButtons = normalizedButtons.filter(
      (button): button is RequestContactButton => button.type === 'request_contact'
    );
    const requestEmailButtons = normalizedButtons.filter(
      (button): button is RequestEmailButton => button.type === 'request_email'
    );
    type InlineButton = Exclude<BotButton, RequestContactButton | RequestEmailButton> & {
      type: 'navigation' | 'url';
    };
    const inlineButtons = normalizedButtons.filter(
      (button): button is InlineButton => button.type === 'navigation' || button.type === 'url'
    );

    const inlineKeyboardButtons = inlineButtons.map((button) => {
      if (button.type === 'url') {
        if (!button.url) {
          throw new Error('UrlButton is missing url');
        }
        return { text: button.text, url: button.url };
      }
      if (!button.nextState) {
        throw new Error('Navigation button missing nextState');
      }
      return { text: button.text, nextState: button.nextState };
    });
    const inlineKeyboard: Array<Array<InlineButton>> = [];
    for (let i = 0; i < inlineButtons.length; i += 2) {
      inlineKeyboard.push(inlineButtons.slice(i, i + 2));
    }

    const replyKeyboard = requestContactButtons.map((button) => ({
      text: button.text,
      nextState: button.nextState,
    }));

    if (state.mediaGroup && state.mediaGroup.length > 0) {
      try {
        if (requestContactButtons.length > 0) {
          await sendTelegramMessageWithReplyKeyboard(
            requestLogger,
            botToken,
            chatId,
            state.message,
            replyKeyboard,
            parseMode
          );
          const nextButton = requestContactButtons[0];
          if (!nextButton) {
            return;
          }
          await setPendingInput(botId, userId, {
            type: 'contact',
            nextState: nextButton.nextState,
            stateId: stateKey,
            ts: Date.now(),
          });
        } else if (inlineButtons.length > 0) {
          await sendTelegramMessageWithKeyboard(
            requestLogger,
            botToken,
            chatId,
            state.message,
            inlineKeyboardButtons,
            parseMode
          );
        } else if (state.message) {
          await sendTelegramMessage(requestLogger, botToken, chatId, state.message, parseMode);
        }

        await sendMediaGroup(
          requestLogger,
          botToken,
          chatId,
          state.mediaGroup.map((item) => ({
            type: item.type,
            url: item.url,
            caption: item.caption,
          })),
          parseMode
        );

        if (requestEmailButtons.length > 0) {
          const nextButton = requestEmailButtons[0];
          if (!nextButton) {
            return;
          }
          await sendTelegramMessage(requestLogger, botToken, chatId, 'Введите email...', parseMode);
          await setPendingInput(botId, userId, {
            type: 'email',
            nextState: nextButton.nextState,
            stateId: stateKey,
            ts: Date.now(),
          });
        }

        requestLogger.info({ stateKey, type: 'media_group' }, 'State message sent');
      } catch (error) {
        requestLogger.error({ error, stateKey }, 'Failed to send media group');
        await sendTelegramMessage(requestLogger, botToken, chatId, state.message, parseMode);
      }
    } else if (state.media) {
      const caption = state.media.caption ?? state.message;
      const inlineReplyMarkup =
        inlineKeyboard.length > 0
          ? {
              inline_keyboard: inlineKeyboard.map((row) =>
                row.map((btn) => {
                  if (btn.type === 'url') {
                    if (!btn.url) {
                      throw new Error('UrlButton is missing url');
                    }
                    return { text: btn.text, url: btn.url };
                  }
                  if (!btn.nextState) {
                    throw new Error('Navigation button missing nextState');
                  }
                  return { text: btn.text, callback_data: btn.nextState };
                })
              ),
            }
          : undefined;
      const replyMarkup =
        requestContactButtons.length > 0
          ? {
              keyboard: replyKeyboard.map((button) => [
                {
                  text: button.text,
                  request_contact: true,
                },
              ]),
              resize_keyboard: true,
              one_time_keyboard: true,
            }
          : inlineReplyMarkup;

      try {
        if (state.media.type === 'photo') {
          await sendPhoto(
            requestLogger,
            botToken,
            chatId,
            state.media.url,
            caption,
            parseMode,
            replyMarkup
          );
        } else if (state.media.type === 'video') {
          await sendVideo(
            requestLogger,
            botToken,
            chatId,
            state.media.url,
            caption,
            parseMode,
            state.media.cover,
            replyMarkup,
            state.media.thumbnail
          );
        } else if (state.media.type === 'document') {
          await sendDocument(
            requestLogger,
            botToken,
            chatId,
            state.media.url,
            caption,
            parseMode,
            replyMarkup
          );
        } else if (state.media.type === 'audio') {
          await sendAudio(
            requestLogger,
            botToken,
            chatId,
            state.media.url,
            caption,
            parseMode,
            replyMarkup
          );
        }

        if (requestContactButtons.length > 0) {
          const nextButton = requestContactButtons[0];
          if (!nextButton) {
            return;
          }
          await setPendingInput(botId, userId, {
            type: 'contact',
            nextState: nextButton.nextState,
            stateId: stateKey,
            ts: Date.now(),
          });
        }

        if (requestEmailButtons.length > 0) {
          const nextButton = requestEmailButtons[0];
          if (!nextButton) {
            return;
          }
          await sendTelegramMessage(requestLogger, botToken, chatId, 'Введите email...', parseMode);
          await setPendingInput(botId, userId, {
            type: 'email',
            nextState: nextButton.nextState,
            stateId: stateKey,
            ts: Date.now(),
          });
        }

        requestLogger.info({ stateKey, type: 'media' }, 'State message sent');
      } catch (error) {
        requestLogger.error({ error, stateKey }, 'Failed to send media');
        await sendTelegramMessage(requestLogger, botToken, chatId, state.message, parseMode);
      }
    } else if (requestContactButtons.length > 0) {
      await sendTelegramMessageWithReplyKeyboard(
        requestLogger,
        botToken,
        chatId,
        state.message,
        replyKeyboard,
        parseMode
      );
      const nextButton = requestContactButtons[0];
      if (!nextButton) {
        return;
      }
      await setPendingInput(botId, userId, {
        type: 'contact',
        nextState: nextButton.nextState,
        stateId: stateKey,
        ts: Date.now(),
      });
      requestLogger.info({ stateKey, hasButtons: true, type: 'request_contact' }, 'State message sent');
    } else if (requestEmailButtons.length > 0) {
      await sendTelegramMessage(requestLogger, botToken, chatId, 'Введите email...', parseMode);
      const nextButton = requestEmailButtons[0];
      if (!nextButton) {
        return;
      }
      await setPendingInput(botId, userId, {
        type: 'email',
        nextState: nextButton.nextState,
        stateId: stateKey,
        ts: Date.now(),
      });
      requestLogger.info({ stateKey, hasButtons: true, type: 'request_email' }, 'State message sent');
    } else if (inlineButtons.length > 0) {
      await sendTelegramMessageWithKeyboard(
        requestLogger,
        botToken,
        chatId,
        state.message,
        inlineKeyboardButtons,
        parseMode
      );
      requestLogger.info({ stateKey, hasButtons: true, type: 'navigation' }, 'State message sent');
    } else {
      await sendTelegramMessage(requestLogger, botToken, chatId, state.message, parseMode);
      requestLogger.info({ stateKey, hasButtons: false }, 'State message sent');
    }

    let cachedPayload: ReturnType<typeof prepareWebhookPayload> | null = null;
    let cachedUserProfile: Awaited<ReturnType<typeof getBotUserProfile>> | null = null;
    const getPayload = async () => {
      if (cachedPayload) {
        return cachedPayload;
      }
      cachedUserProfile = cachedUserProfile ?? await getBotUserProfile(botId, userId, requestLogger);
      cachedPayload = prepareWebhookPayload(
        botId,
        userId,
        stateKey,
        cachedUserProfile,
        schema,
        previousState ?? undefined
      );
      return cachedPayload;
    };

    if (state.webhook?.enabled && state.webhook.url) {
      try {
        const payload = await getPayload();
        const retryCount =
          typeof state.webhook.retryCount === 'number'
            ? state.webhook.retryCount
            : WEBHOOK_INTEGRATION_LIMITS.MAX_RETRY_COUNT;

        const isServerless = process.env.VERCEL === '1';
        if (isServerless) {
          const timeout = Math.min(
            state.webhook.timeout ?? WEBHOOK_INTEGRATION_LIMITS.TIMEOUT_MS,
            WEBHOOK_INTEGRATION_LIMITS.AWAIT_FIRST_ATTEMPT_TIMEOUT_MS
          );
          const result = await sendWebhook(
            { ...state.webhook, timeout },
            payload,
            requestLogger
          );
          await createWebhookLog(
            botId,
            stateKey,
            userId,
            state.webhook.url,
            payload,
            result.status,
            result.response,
            result.error ?? null,
            result.retryCount ?? 0
          );
        } else {
          const result = await sendWebhookWithRetry(
            state.webhook,
            payload,
            requestLogger,
            retryCount
          );
          await createWebhookLog(
            botId,
            stateKey,
            userId,
            state.webhook.url,
            payload,
            result.status,
            result.response,
            result.error ?? null,
            result.retryCount ?? 0
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await createWebhookLog(
          botId,
          stateKey,
          userId,
          state.webhook.url,
          null,
          null,
          null,
          message,
          state.webhook.retryCount ?? 0
        );
        requestLogger.error({ error, stateKey }, 'Failed to send webhook');
      }
    }

    if (state.integration && state.integration.type && state.integration.type !== 'custom') {
      const integrationStart = Date.now();
      try {
        const payload = await getPayload();
        const integrationPayload = {
          provider: state.integration.type,
          data: payload,
        };
        const isServerless = process.env.VERCEL === '1';
        const timeout = isServerless
          ? WEBHOOK_INTEGRATION_LIMITS.AWAIT_FIRST_ATTEMPT_TIMEOUT_MS
          : WEBHOOK_INTEGRATION_LIMITS.TIMEOUT_MS;

        if (state.integration.type === 'google_sheets') {
          const config = state.integration.config as { spreadsheetUrl?: string; sheetName?: string; columns?: string[] };
          if (!config?.spreadsheetUrl) {
            await createWebhookLog(
              botId,
              stateKey,
              userId,
              'integration:google_sheets',
              integrationPayload,
              null,
              { duration_ms: Date.now() - integrationStart },
              'Missing spreadsheetUrl in integration config',
              0
            );
          } else {
            const result = await sendToGoogleSheets(
              {
                spreadsheetUrl: config.spreadsheetUrl,
                sheetName: config.sheetName,
                columns: config.columns,
              },
              payload,
              timeout
            );
            await createWebhookLog(
              botId,
              stateKey,
              userId,
              config.spreadsheetUrl,
              integrationPayload,
              result.status ?? null,
              { duration_ms: Date.now() - integrationStart, response: result.response ?? null },
              null,
              0
            );
          }
        } else if (state.integration.type === 'telegram_channel') {
          const config = state.integration.config as { channelId?: string; messageTemplate?: string };
          if (!config?.channelId) {
            await createWebhookLog(
              botId,
              stateKey,
              userId,
              'integration:telegram_channel',
              integrationPayload,
              null,
              { duration_ms: Date.now() - integrationStart },
              'Missing channelId in integration config',
              0
            );
          } else {
            const result = await sendToTelegramChannel(
              {
                channelId: config.channelId,
                messageTemplate: config.messageTemplate,
              },
              botToken,
              payload,
              timeout
            );
            await createWebhookLog(
              botId,
              stateKey,
              userId,
              `telegram_channel:${config.channelId}`,
              integrationPayload,
              result.status ?? null,
              { duration_ms: Date.now() - integrationStart, response: result.response ?? null },
              null,
              0
            );
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await createWebhookLog(
          botId,
          stateKey,
          userId,
          `integration:${state.integration.type}`,
          null,
          null,
          { duration_ms: Date.now() - integrationStart },
          message,
          0
        );
        requestLogger.error({ error, stateKey }, 'Failed to send provider integration');
      }
    }
  } catch (error) {
    requestLogger.error(
      { stateKey, error, metric: 'telegram_send_error' },
      '❌ Failed to send state message:'
    );
    throw error;
  }
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

app.use(errorMetricsMiddleware as any);

// Обработка ошибок
function classifyError(error: any) {
  const name = error?.name || '';
  const message = error?.message || '';
  const code = error?.code || '';
  const combined = `${name} ${message} ${code}`.toLowerCase();

  if (combined.includes('telegram')) {
    return { errorType: 'TelegramAPIError', statusCode: 502, message: 'Telegram API error' };
  }
  if (combined.includes('redis')) {
    return { errorType: 'RedisError', statusCode: 503, message: 'Redis error' };
  }
  if (combined.includes('postgres') || combined.includes('database') || combined.includes('pg') || combined.includes('sql')) {
    return { errorType: 'DatabaseError', statusCode: 503, message: 'Database error' };
  }
  if (combined.includes('validation') || combined.includes('invalid')) {
    return { errorType: 'ValidationError', statusCode: 400, message: 'Validation error' };
  }
  return { errorType: 'UnknownError', statusCode: 500, message: 'Internal server error' };
}

app.use((err: unknown, req: Request, res: Response, next: Function) => {
  if (res.headersSent) {
    return next(err);
  }

  const e = err as any;
  const requestId = (req as any).id;
  const method = req.method;
  const path = req.originalUrl ?? req.path;
  const botId = (req as any).params?.botId;
  const update = (req as any).body;
  const updateType =
    (req as any).updateType
    ?? (update?.message ? 'message' : update?.callback_query ? 'callback_query' : update ? 'unknown' : undefined);
  const userId =
    (req as any).user?.id ?? update?.message?.from?.id ?? update?.callback_query?.from?.id;
  const classification = classifyError(e);
  const statusCode = e?.statusCode ?? e?.status ?? classification.statusCode ?? 500;
  const isWebhook = (req.originalUrl ?? req.path).startsWith('/webhook/');

  logger.error(
    {
      requestId,
      method,
      path,
      botId,
      userId,
      updateType,
      statusCode,
      errorType: classification.errorType,
      error: {
        name: e?.name,
        message: e?.message,
        stack: e?.stack,
        code: e?.code,
      },
    },
    '❌ Unhandled error'
  );

  logger.info({ metric: 'error_by_type', errorType: classification.errorType, count: 1 }, 'Error metric');

  if (isWebhook) {
    logger.info({ metric: 'webhook_error', requestId, botId, userId, updateType }, 'Webhook error');
  }

  if (isWebhook && statusCode >= 500) {
    if (res.headersSent) {
      return next(err);
    }
    res.status(200).json({
      status: 'error',
      requestId,
    });
    return;
  }

  const message =
    process.env.NODE_ENV === 'production'
      ? 'An error occurred'
      : e instanceof Error
        ? e.message
        : String(e);

  res.status(statusCode).json({
    error: classification.message,
    message,
    requestId,
    timestamp: new Date().toISOString(),
  });
});

// Обработка 404
app.use((req: Request, res: Response) => {
  const requestId = (req as any).id;
  logger.warn({ requestId, method: req.method, path: req.path }, '❌ Route not found');
  res.status(404).json({ error: 'Route not found' });
});
}

// Запуск сервера
if (process.env.NODE_ENV !== 'test') {
  startServer().catch((error) => {
    logger.error({ error }, 'Failed to start router server:');
  });
}

// Graceful shutdown
let isShuttingDown = false;

async function shutdown(exitCode = 0) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  const forceExitTimer = setTimeout(() => {
    logger.fatal({ exitCode: 1 }, 'Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
  if (typeof forceExitTimer.unref === 'function') {
    forceExitTimer.unref();
  }

  logger.info('🛑 Shutting down gracefully...');
  
  try {
    if (server) {
      server.close(() => {
        logger.info('✅ HTTP server closed');
      });
    }

    await closePostgres();
    logger.info('✅ PostgreSQL pool closed');
    
    await closeRedis();
    logger.info('✅ Redis connection closed');
  } catch (error) {
    logger.error({ error }, 'Graceful shutdown failed');
    exitCode = 1;
  } finally {
    clearTimeout(forceExitTimer);
  }

  process.exit(exitCode);
}

process.on('unhandledRejection', (reason, promise) => {
  const error = reason as any;
  logger.error({ reason, promise, message: error?.message, stack: error?.stack }, 'Unhandled Promise Rejection');
});

process.on('uncaughtException', (error) => {
  logger.fatal({ error }, 'Uncaught Exception');
  shutdown(1).catch((shutdownError) => {
    logger.error({ error: shutdownError }, 'Graceful shutdown failed');
    process.exit(1);
  });
});

process.once('SIGINT', () => shutdown(0));
process.once('SIGTERM', () => shutdown(0));



