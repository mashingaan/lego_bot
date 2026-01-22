import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { Telegraf, session } from 'telegraf';
import { Scenes } from 'telegraf';
import { initPostgres, closePostgres } from './db/postgres';
import { initRedis, closeRedis } from './db/redis';
import { initializeBotsTable, getBotsByUserId, getBotById, updateBotSchema } from './db/bots';
import { createBotScene } from './bot/scenes';
import { handleStart, handleCreateBot, handleMyBots, handleHelp } from './bot/commands';
import { handleSetWebhook, handleDeleteWebhook } from './bot/webhook-commands';
import { handleEditSchema } from './bot/schema-commands';
import path from 'path';
import * as crypto from 'crypto';

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
console.log('📄 Загрузка .env из:', envPath);

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database connections
let dbInitialized = false;
let dbInitializationPromise: Promise<void> | null = null;
let redisAvailable = true;

async function initializeDatabases() {
  if (dbInitialized) {
    console.log('??? Databases already initialized');
    return;
  }
  
  if (dbInitializationPromise) {
    console.log('??? Database initialization in progress, waiting...');
    return dbInitializationPromise;
  }
  
  console.log('???? Initializing databases...');
  console.log('???? Environment variables:');
  console.log('  DATABASE_URL:', process.env.DATABASE_URL ? `${process.env.DATABASE_URL.substring(0, 20)}...` : 'NOT SET');
  console.log('  REDIS_URL:', process.env.REDIS_URL ? `${process.env.REDIS_URL.substring(0, 20)}...` : 'NOT SET');
  
  dbInitializationPromise = (async () => {
    try {
      console.log('???? Initializing PostgreSQL...');
      try {
        await initPostgres();
        console.log('??? PostgreSQL initialized');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const postgresError = new Error(`PostgreSQL initialization failed: ${message}`);
        (postgresError as any).database = 'postgres';
        throw postgresError;
      }
      
      console.log('???? Initializing Redis...');
      try {
        const redisClient = await initRedis();
        if (redisClient) {
          console.log('??? Redis initialized');
          redisAvailable = true;
        } else {
          redisAvailable = false;
          console.warn('?????? Redis initialization failed, continuing without cache');
        }
      } catch (error) {
        redisAvailable = false;
        console.warn('?????? Redis initialization failed, continuing without cache:', error);
      }

      console.log('???? Validating PostgreSQL connection...');
      const { getPool } = await import('./db/postgres');
      const pool = getPool();
      if (!pool) {
        const postgresError = new Error('PostgreSQL pool is not initialized');
        (postgresError as any).database = 'postgres';
        throw postgresError;
      }

      try {
        await pool.query('SELECT 1');
        console.log('??? PostgreSQL connection verified');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const postgresError = new Error(`PostgreSQL connection validation failed: ${message}`);
        (postgresError as any).database = 'postgres';
        throw postgresError;
      }

      if (redisAvailable) {
        try {
          const { getRedisClient } = await import('./db/redis');
          const redisClient = await getRedisClient();
          await redisClient.ping();
          console.log('??? Redis connection verified');
        } catch (error) {
          redisAvailable = false;
          console.warn('?????? Redis ping failed, continuing without cache:', error);
        }
      }
      
      console.log('???? Initializing bots table...');
      // ?????????????????????????? ?????????????? bots
      await initializeBotsTable();
      console.log('??? Database tables initialized');
      dbInitialized = true;
      console.log('??? All databases initialized successfully');
    } catch (error) {
      console.error('??? Failed to initialize databases:', error);
      console.error('Error type:', error?.constructor?.name);
      console.error('Error message:', error instanceof Error ? error.message : String(error));
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack');
      dbInitializationPromise = null; // Reset to allow retry
      throw error;
    }
  })();
  
  return dbInitializationPromise;
}

// Middleware для проверки инициализации БД
async function ensureDatabasesInitialized(req: Request, res: Response, next: Function) {
  try {
    console.log('🔍 ensureDatabasesInitialized - checking DB initialization...');
    console.log('📊 DB initialized flag:', dbInitialized);
    
    await initializeDatabases();
    console.log('✅ Databases initialized, proceeding with request');
    next();
  } catch (error) {
    console.error('❌ Database initialization error in middleware:', error);
    console.error('Error type:', error?.constructor?.name);
    console.error('Error message:', error instanceof Error ? error.message : String(error));
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack');
    
    // Логируем переменные окружения (без секретов)
    console.log('🔍 Environment check:');
    console.log('  DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'NOT SET');
    console.log('  REDIS_URL:', process.env.REDIS_URL ? 'SET' : 'NOT SET');
    console.log('  VERCEL:', process.env.VERCEL);
    console.log('  NODE_ENV:', process.env.NODE_ENV);
    const failedDatabase = (error as any)?.database || 'postgres';

    res.status(503).json({ 
      error: 'Service temporarily unavailable',
      message: 'Database initialization failed',
      database: failedDatabase,
      details: error instanceof Error ? error.message : String(error),
      hint: 'Check Vercel logs for detailed error information',
    });
  }
}

// Инициализация БД при запуске (не блокирующая)
if (process.env.VERCEL !== '1') {
  // Локально инициализируем сразу
  initializeDatabases().catch((error) => {
    console.error('Failed to initialize databases on startup:', error);
  });
} else {
  // На Vercel инициализируем лениво при первом запросе
  console.log('📦 Vercel environment detected - databases will be initialized on first request');
}

// CORS configuration
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const MINI_APP_URL = process.env.MINI_APP_URL || 'https://lego-bot-miniapp.vercel.app';
const MINI_APP_DEV_URL = 'http://localhost:5174';
const MINI_APP_DEV_URL_127 = 'http://127.0.0.1:5174';
const allowedOrigins = [FRONTEND_URL, MINI_APP_URL, MINI_APP_DEV_URL, MINI_APP_DEV_URL_127].filter(Boolean);

console.log('🌐 CORS configuration:');
console.log('  FRONTEND_URL:', FRONTEND_URL);
console.log('  MINI_APP_URL:', MINI_APP_URL);
console.log('  MINI_APP_DEV_URL:', MINI_APP_DEV_URL);
console.log('  MINI_APP_DEV_URL_127:', MINI_APP_DEV_URL_127);
console.log('  Allowed origins:', allowedOrigins);

app.use(cors({
  origin: (origin, callback) => {
    console.log('🔍 CORS check - origin:', origin);
    // Разрешаем запросы без origin (например, мобильные приложения, Telegram)
    if (!origin) {
      console.log('✅ CORS: No origin, allowing');
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin) || origin.includes('localhost') || origin.includes('127.0.0.1')) {
      console.log('✅ CORS: Origin allowed:', origin);
      callback(null, true);
    } else {
      console.log('✅ CORS: Allowing all origins (permissive mode):', origin);
      callback(null, true); // Разрешаем все для упрощения
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Логирование всех входящих запросов
app.use((req: Request, res: Response, next: Function) => {
  console.log('📨 Incoming request:', {
    method: req.method,
    path: req.path,
    url: req.url,
    origin: req.headers.origin,
    'user-agent': req.headers['user-agent']?.substring(0, 50),
  });
  next();
});

// Webhook endpoint для основного бота (должен быть ДО express.json() для raw body)
// Регистрируем сразу, но обработчик будет работать только если botInstance инициализирован
app.post('/api/webhook', express.raw({ type: 'application/json' }), ensureDatabasesInitialized as any, async (req: Request, res: Response) => {
  try {
    console.log('✅ Webhook DB initialization complete, processing update');
    // Проверяем, что бот инициализирован
    if (!botInstance) {
      console.error('❌ Bot instance not initialized in webhook handler');
      return res.status(503).json({ error: 'Bot not initialized' });
    }
    
    const update = JSON.parse(req.body.toString());
    console.log('📨 Webhook received:', {
      updateId: update.update_id,
      type: update.message ? 'message' : update.callback_query ? 'callback_query' : 'unknown',
    });
    
    await botInstance.handleUpdate(update);
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('❌ Webhook error:', error);
    // Всегда возвращаем 200 для Telegram, чтобы не было повторных запросов
    res.status(200).json({ ok: true });
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Обработка OPTIONS запросов (CORS preflight) - должен быть после CORS middleware
app.options('*', (req: Request, res: Response) => {
  console.log('🔧 CORS preflight request:', {
    path: req.path,
    origin: req.headers.origin,
    method: req.headers['access-control-request-method'],
    headers: req.headers['access-control-request-headers'],
  });
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.status(200).end();
});

// Health check
app.get('/health', async (req: Request, res: Response) => {
  const { getPool } = await import('./db/postgres');
  const { getRedisClientOptional } = await import('./db/redis');
  
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    databases: {
      postgres: 'connecting',
      redis: 'connecting',
    },
  };

  let postgresState: 'connecting' | 'ready' | 'error' = 'connecting';
  if (!dbInitialized) {
    postgresState = dbInitializationPromise ? 'connecting' : 'error';
  } else {
    try {
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

  health.databases.postgres = postgresState;

  let redisState: 'connecting' | 'ready' | 'error' = 'connecting';
  if (!dbInitialized) {
    redisState = dbInitializationPromise ? 'connecting' : 'error';
  } else if (!redisAvailable) {
    redisState = 'error';
  } else {
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
  }

  health.databases.redis = redisState;

  if (postgresState === 'ready') {
    health.status = redisState === 'ready' ? 'ok' : 'degraded';
  } else {
    health.status = 'error';
  }

  const statusCode = postgresState === 'ready' ? 200 : 503;
  res.status(statusCode).json(health);
});

// Middleware для проверки user_id (упрощенная авторизация без Telegram)
async function requireUserId(req: Request, res: Response, next: Function) {
  // user_id может быть в query (GET) или в query (POST через URL)
  const userId = req.query.user_id as string;
  
  if (!userId) {
    return res.status(400).json({ error: 'Missing user_id parameter in query string' });
  }

  const userIdNum = parseInt(userId, 10);
  if (isNaN(userIdNum)) {
    return res.status(400).json({ error: 'Invalid user_id format. Must be a number' });
  }

  (req as any).user = { id: userIdNum };
  next();
}

// API Routes

// GET /api/bots - получить список ботов пользователя
app.get('/api/bots', ensureDatabasesInitialized as any, requireUserId as any, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    console.log('📋 GET /api/bots - userId:', userId);
    
    const bots = await getBotsByUserId(userId);
    console.log('✅ Found bots:', bots.length);
    
    // Убираем токены из ответа
    const safeBots = bots.map(bot => ({
      id: bot.id,
      name: bot.name,
      webhook_set: bot.webhook_set,
      schema_version: bot.schema_version,
      created_at: bot.created_at,
    }));
    
    console.log('✅ Returning safe bots:', safeBots.length);
    res.json(safeBots);
  } catch (error) {
    console.error('❌ Error fetching bots:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack');
    console.error('Error message:', error instanceof Error ? error.message : String(error));
    res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// GET /api/bot/:id/schema - получить схему бота
app.get('/api/bot/:id/schema', ensureDatabasesInitialized as any, requireUserId as any, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const botId = req.params.id;
    
    const bot = await getBotById(botId, userId);
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }
    
    if (!bot.schema) {
      return res.status(404).json({ error: 'Schema not found' });
    }
    
    res.json(bot.schema);
  } catch (error) {
    console.error('Error fetching schema:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/bot/:id/schema - обновить схему бота
app.post('/api/bot/:id/schema', ensureDatabasesInitialized as any, requireUserId as any, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const botId = req.params.id;
    const schema = req.body;
    
    // Валидация схемы
    if (!schema || typeof schema !== 'object') {
      return res.status(400).json({ error: 'Invalid schema format' });
    }
    
    if (schema.version !== 1) {
      return res.status(400).json({ error: 'Invalid schema version. Must be 1' });
    }
    
    if (!schema.states || typeof schema.states !== 'object') {
      return res.status(400).json({ error: 'Invalid states format' });
    }
    
    if (!schema.initialState || typeof schema.initialState !== 'string') {
      return res.status(400).json({ error: 'Invalid initialState' });
    }
    
    // Проверяем, что бот принадлежит пользователю
    const bot = await getBotById(botId, userId);
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' });
    }
    
    // Обновляем схему
    const success = await updateBotSchema(botId, userId, schema);
    if (!success) {
      return res.status(500).json({ error: 'Failed to update schema' });
    }
    
    res.json({ 
      success: true, 
      message: 'Schema updated successfully',
      schema_version: (bot.schema_version || 0) + 1
    });
  } catch (error) {
    console.error('Error updating schema:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Initialize Telegram bot
const botToken = process.env.TELEGRAM_BOT_TOKEN;
let botInstance: Telegraf<Scenes.SceneContext> | null = null;

if (!botToken) {
  console.warn('⚠️  TELEGRAM_BOT_TOKEN is not set');
  console.warn('⚠️  Бот не будет запущен. Установите TELEGRAM_BOT_TOKEN в .env файле');
} else {
  console.log('🔑 Токен бота найден:', botToken.substring(0, 10) + '...');
  // Создание бота с поддержкой сцен (FSM)
  botInstance = new Telegraf<Scenes.SceneContext>(botToken);
  
  // Настройка сессий (используем память для простоты, в продакшене лучше Redis)
  botInstance.use(session());
  
  // Регистрация сцен
  const stage = new Scenes.Stage<Scenes.SceneContext>([createBotScene as any]);
  botInstance.use(stage.middleware());
  
  // Логирование всех входящих обновлений для отладки (ПОСЛЕ middleware, НО перед командами)
  botInstance.use(async (ctx, next) => {
    console.log('📨 Получено обновление:', {
      updateId: ctx.update.update_id,
      type: ctx.updateType,
      from: ctx.from?.id,
      username: ctx.from?.username,
      text: ctx.message && 'text' in ctx.message ? ctx.message.text : undefined,
      chatId: ctx.chat?.id,
      command: ctx.message && 'text' in ctx.message && ctx.message.text?.startsWith('/') ? ctx.message.text : undefined,
    });
    return next();
  });
  
  // Регистрация команд
  botInstance.command('start', async (ctx) => {
    console.log('🎯 Команда /start получена от:', ctx.from?.id, ctx.from?.username);
    try {
      await handleStart(ctx as any);
      console.log('✅ Команда /start обработана успешно');
    } catch (error) {
      console.error('❌ Error in /start command:', error);
      try {
        await ctx.reply('❌ Произошла ошибка при обработке команды.');
      } catch (replyError) {
        console.error('❌ Failed to send error message:', replyError);
      }
    }
  });
  
  botInstance.command('create_bot', async (ctx) => {
    try {
      if (ctx.scene) {
        await handleCreateBot(ctx as Scenes.SceneContext);
      } else {
        ctx.reply('❌ Сцены не инициализированы.').catch(console.error);
      }
    } catch (error) {
      console.error('Error in /create_bot command:', error);
      ctx.reply('❌ Произошла ошибка при обработке команды.').catch(console.error);
    }
  });
  
  botInstance.command('my_bots', async (ctx) => {
    try {
      await handleMyBots(ctx as any);
    } catch (error) {
      console.error('Error in /my_bots command:', error);
      ctx.reply('❌ Произошла ошибка при обработке команды.').catch(console.error);
    }
  });
  
  botInstance.command('help', async (ctx) => {
    try {
      await handleHelp(ctx as any);
    } catch (error) {
      console.error('Error in /help command:', error);
      ctx.reply('❌ Произошла ошибка при обработке команды.').catch(console.error);
    }
  });
  
  // Обработка callback_query (кнопки)
  botInstance.action('back_to_menu', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      await handleStart(ctx as any);
      console.log('✅ Возврат в главное меню');
    } catch (error) {
      console.error('Error handling back_to_menu:', error);
      ctx.answerCbQuery('Ошибка при возврате в меню').catch(console.error);
    }
  });
  
  botInstance.action('create_bot', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      if (ctx.scene) {
        await handleCreateBot(ctx as Scenes.SceneContext);
      } else {
        await ctx.reply('❌ Сцены не инициализированы.');
      }
    } catch (error) {
      console.error('Error handling create_bot action:', error);
      ctx.answerCbQuery('Ошибка').catch(console.error);
    }
  });
  
  botInstance.action('my_bots', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      await handleMyBots(ctx as any);
    } catch (error) {
      console.error('Error handling my_bots action:', error);
      ctx.answerCbQuery('Ошибка').catch(console.error);
    }
  });
  
  botInstance.action('help', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      await handleHelp(ctx as any);
    } catch (error) {
      console.error('Error handling help action:', error);
      ctx.answerCbQuery('Ошибка').catch(console.error);
    }
  });

  // Команда для настройки webhook основного бота
  botInstance.command('setup_webhook', async (ctx) => {
    try {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        await ctx.reply('❌ TELEGRAM_BOT_TOKEN не установлен в переменных окружения.');
        return;
      }

      // Всегда используем production URL для webhook
      // VERCEL_URL может указывать на preview deployment, поэтому игнорируем его
      // Используем API_URL если установлен, иначе hardcode production URL
      const apiUrl = process.env.API_URL || 'https://lego-bot-core.vercel.app';
      const webhookUrl = `${apiUrl}/api/webhook`;
      
      console.log(`🔗 Setting webhook to production URL: ${webhookUrl}`);
      console.log(`   API_URL env: ${process.env.API_URL || 'not set'}`);
      console.log(`   VERCEL_URL env: ${process.env.VERCEL_URL || 'not set'} (ignored)`);

      const { setWebhook } = await import('./services/telegram-webhook');
      const result = await setWebhook(botToken, webhookUrl);

      if (result.ok) {
        await ctx.reply(
          `✅ <b>Webhook для основного бота настроен!</b>\n\n` +
          `🔗 URL: <code>${webhookUrl}</code>\n\n` +
          `Теперь бот будет работать на Vercel.`,
          { parse_mode: 'HTML' }
        );
        console.log(`✅ Main bot webhook configured: ${webhookUrl}`);
      } else {
        throw new Error(result.description || 'Unknown error');
      }
    } catch (error) {
      console.error('Error setting main bot webhook:', error);
      await ctx.reply(
        `❌ Ошибка настройки webhook: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // Команда /setwebhook <bot_id>
  botInstance.command('setwebhook', async (ctx) => {
    try {
      const message = ctx.message;
      if (!('text' in message)) return;
      
      const parts = message.text.split(' ');
      const botId = parts[1]; // Второй аргумент после команды
      
      await handleSetWebhook(ctx as any, botId);
    } catch (error) {
      console.error('Error in /setwebhook command:', error);
      ctx.reply('❌ Произошла ошибка при обработке команды.').catch(console.error);
    }
  });

  // Команда /deletewebhook <bot_id>
  botInstance.command('deletewebhook', async (ctx) => {
    try {
      const message = ctx.message;
      if (!('text' in message)) return;
      
      const parts = message.text.split(' ');
      const botId = parts[1]; // Второй аргумент после команды
      
      await handleDeleteWebhook(ctx as any, botId);
    } catch (error) {
      console.error('Error in /deletewebhook command:', error);
      ctx.reply('❌ Произошла ошибка при обработке команды.').catch(console.error);
    }
  });

  // Команда /editschema <bot_id> <json>
  botInstance.command('editschema', async (ctx) => {
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
    } catch (error) {
      console.error('Error in /editschema command:', error);
      ctx.reply('❌ Произошла ошибка при обработке команды.').catch(console.error);
    }
  });
  
  // Обработка ошибок
  botInstance.catch((err, ctx) => {
    console.error('Error in bot:', err);
    ctx.reply('❌ Произошла ошибка. Попробуйте позже.').catch(console.error);
  });
  

  // Запуск бота через long polling (только локально, не на Vercel)
  if (process.env.VERCEL !== '1') {
    botInstance.launch({
      allowedUpdates: ['message', 'callback_query'],
      dropPendingUpdates: false,
    }).then(() => {
      console.log('✅ Telegram bot started successfully (long polling)');
      console.log('✅ Бот готов к работе');
      botInstance?.telegram.getMe().then((botInfo) => {
        console.log('🤖 Bot info:', {
          id: botInfo.id,
          username: botInfo.username,
          firstName: botInfo.first_name,
        });
        console.log('💬 Отправьте боту /start для проверки');
      }).catch(console.error);
    }).catch((error) => {
      console.error('❌ Failed to launch bot:', error);
      console.error('Проверьте:');
      console.error('1. Правильность токена в .env файле');
      console.error('2. Подключение к интернету');
      console.error('3. Доступность Telegram API');
    });
  } else {
    console.log('🔗 Bot configured for webhook mode (Vercel serverless)');
    console.log('📡 Webhook endpoint: /api/webhook');
    console.log('⚠️  Не забудьте настроить webhook через Telegram API');
    console.log('💡 Используйте: https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://lego-bot-core.vercel.app/api/webhook');
  }
}

// Start server (only in non-serverless environment)
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

// Export app for Vercel serverless functions
export default app;
module.exports = app; // Also export as CommonJS for compatibility

// Export botInstance for webhook endpoint
export { botInstance };
if (typeof module !== 'undefined') {
  (module.exports as any).botInstance = botInstance;
}

// Graceful shutdown
async function shutdown() {
  console.log('Shutting down gracefully...');
  
  if (botInstance) {
    await botInstance.stop('SIGTERM');
  }
  
  await closePostgres();
  await closeRedis();
  
  process.exit(0);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

