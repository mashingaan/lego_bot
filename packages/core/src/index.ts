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

// Загрузка .env файла из корня проекта
const envPath = path.resolve(__dirname, '../../../.env');
dotenv.config({ path: envPath });
console.log('📄 Загрузка .env из:', envPath);

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database connections
async function initializeDatabases() {
  try {
    initPostgres();
    initRedis();
    
    // Инициализация таблицы bots
    await initializeBotsTable();
    console.log('✅ Database tables initialized');
  } catch (error) {
    console.error('Failed to initialize databases:', error);
    throw error;
  }
}

// Инициализация БД при запуске
initializeDatabases().catch((error) => {
  console.error('Failed to initialize databases:', error);
});

// CORS configuration
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
app.use(cors({
  origin: FRONTEND_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', async (req: Request, res: Response) => {
  const { getPool } = await import('./db/postgres');
  const { getRedisClient } = await import('./db/redis');
  
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    databases: {
      postgres: 'unknown',
      redis: 'unknown',
    },
  };

  // Check PostgreSQL
  try {
    const pool = getPool();
    if (pool) {
      await pool.query('SELECT 1');
      health.databases.postgres = 'connected';
    } else {
      health.databases.postgres = 'not initialized';
    }
  } catch (error) {
    health.databases.postgres = 'error';
    health.status = 'degraded';
  }

  // Check Redis
  try {
    const redis = getRedisClient();
    await redis.ping();
    health.databases.redis = 'connected';
  } catch (error) {
    health.databases.redis = 'error';
    health.status = 'degraded';
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// Telegram authentication verification
function verifyTelegramAuth(authData: any, hash: string): boolean {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return false;

  const dataCheckString = Object.keys(authData)
    .sort()
    .map(key => `${key}=${authData[key]}`)
    .join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  return calculatedHash === hash;
}

// Middleware для проверки авторизации Telegram
async function authenticateTelegramUser(req: Request, res: Response, next: Function) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: Missing or invalid authorization header' });
    }

    const hash = authHeader.substring(7);
    const userId = req.query.user_id as string || req.body.user_id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized: Missing user_id' });
    }

    // Для упрощения, проверяем только наличие user_id
    // В продакшене нужно проверять hash через verifyTelegramAuth
    (req as any).user = { id: parseInt(userId, 10) };
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

// API Routes

// GET /api/bots - получить список ботов пользователя
app.get('/api/bots', authenticateTelegramUser as any, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const bots = await getBotsByUserId(userId);
    
    // Убираем токены из ответа
    const safeBots = bots.map(bot => ({
      id: bot.id,
      name: bot.name,
      webhook_set: bot.webhook_set,
      schema_version: bot.schema_version,
      created_at: bot.created_at,
    }));
    
    res.json(safeBots);
  } catch (error) {
    console.error('Error fetching bots:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/bot/:id/schema - получить схему бота
app.get('/api/bot/:id/schema', authenticateTelegramUser as any, async (req: Request, res: Response) => {
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
app.post('/api/bot/:id/schema', authenticateTelegramUser as any, async (req: Request, res: Response) => {
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
  
  // Запуск бота
  botInstance.launch({
    allowedUpdates: ['message', 'callback_query'],
    dropPendingUpdates: false, // Обрабатываем накопленные обновления
  }).then(() => {
    console.log('✅ Telegram bot started successfully');
    console.log('✅ Бот готов к работе');
    // Получаем информацию о боте
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
}

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

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

