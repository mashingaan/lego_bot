/**
 * Router Service - Webhook роутер для созданных ботов
 * 
 * Функциональность:
 * - Принимает webhook от Telegram на /webhook/:botId
 * - Загружает схему бота из PostgreSQL
 * - Определяет состояние пользователя из Redis
 * - Отправляет сообщения и кнопки согласно схеме
 */

import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { initPostgres, getBotById, closePostgres, getBotSchema } from './db/postgres';
import { initRedis, closeRedis, getUserState, setUserState, resetUserState, getRedisClientOptional } from './db/redis';
import { decryptToken } from './utils/encryption';
import { sendTelegramMessage, sendTelegramMessageWithKeyboard, answerCallbackQuery, TelegramUpdate } from './services/telegram';
import { BotSchema } from '@dialogue-constructor/shared/types/bot-schema';

// Загрузка .env файла из корня проекта
const envPath = path.resolve(__dirname, '../../../.env');
dotenv.config({ path: envPath });
console.log('📄 Загрузка .env из:', envPath);

const app = express();
// Router должен использовать ROUTER_PORT, чтобы не конфликтовать с core (PORT=3000)
const PORT = process.env.ROUTER_PORT || 3001;
let server: ReturnType<typeof app.listen> | null = null;

// Инициализация PostgreSQL
async function startServer() {
  try {
    await initPostgres();
    console.log('✅ PostgreSQL pool initialized');
  } catch (error) {
    console.error('❌ Failed to initialize PostgreSQL:', error);
    if (process.env.VERCEL !== '1') {
      process.exit(1);
      return;
    }
    console.warn('⚠️ PostgreSQL initialization failed, continuing without exit');
  }

  try {
    const redisClient = await initRedis();
    if (redisClient) {
      console.log('✅ Redis initialized');
    } else {
      console.warn('⚠️ Redis initialization failed, continuing without cache');
    }
  } catch (error) {
    console.warn('⚠️ Redis initialization failed, continuing without cache:', error);
  }

  server = app.listen(PORT, () => {
    console.log(`?? Router server is running on port ${PORT}`);
    console.log(`?? Webhook endpoint: http://localhost:${PORT}/webhook/:botId`);
  });
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Логирование входящих запросов
app.use((req: Request, res: Response, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`, {
    ip: req.ip,
    headers: {
      'user-agent': req.get('user-agent'),
      'content-type': req.get('content-type'),
    },
  });
  next();
});

// Health check
app.get('/health', async (req: Request, res: Response) => {
  let postgresState: 'ready' | 'error' = 'error';
  let redisState: 'ready' | 'error' = 'error';

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

  const status = postgresState === 'ready'
    ? (redisState === 'ready' ? 'ok' : 'degraded')
    : 'error';
  const statusCode = postgresState === 'ready' ? 200 : 503;

  res.status(statusCode).json({
    status,
    timestamp: new Date().toISOString(),
    service: 'router',
    databases: {
      postgres: postgresState,
      redis: redisState,
    },
  });
});

// Webhook endpoint
app.post('/webhook/:botId', async (req: Request, res: Response) => {
  const { botId } = req.params;
  const update: TelegramUpdate = req.body;

  console.log(`📨 Webhook received for botId: ${botId}`);

  try {
    // Валидация botId
    if (!botId || typeof botId !== 'string') {
      console.error('❌ Invalid botId:', botId);
      return res.status(400).json({ error: 'Invalid botId' });
    }

    // Получаем бота из базы данных
    const bot = await getBotById(botId);
    if (!bot) {
      console.error(`❌ Bot not found: ${botId}`);
      return res.status(404).json({ error: 'Bot not found' });
    }

    console.log(`✅ Bot found: ${bot.name} (${bot.id})`);

    // Расшифровываем токен
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      console.error('❌ ENCRYPTION_KEY is not set');
      return res.status(500).json({ error: 'Encryption key not configured' });
    }

    let decryptedToken: string;
    try {
      decryptedToken = decryptToken(bot.token, encryptionKey);
      console.log(`✅ Token decrypted for bot: ${bot.name}`);
    } catch (error) {
      console.error('❌ Failed to decrypt token:', error);
      return res.status(500).json({ error: 'Failed to decrypt bot token' });
    }

    // Получаем схему бота
    const schema = await getBotSchema(botId);
    
    if (!schema) {
      // Если схема не настроена, отправляем стандартный ответ
      if (update.message) {
        const chatId = update.message.chat.id;
        const messageText = update.message.text || '';
        
        console.log(`💬 Message from chat ${chatId}: ${messageText.substring(0, 50)}...`);
        console.log(`⚠️  Schema not configured for bot ${botId}`);

        const responseText = 'Привет! Я бот, созданный через конструктор.\n\nСхема диалогов еще не настроена. Используйте команду /editschema для настройки.';
        
        try {
          await sendTelegramMessage(decryptedToken, chatId, responseText);
          console.log(`✅ Message sent to chat ${chatId}`);
        } catch (error) {
          console.error('❌ Failed to send message:', error);
        }
      }
    } else {
      // Обработка с использованием схемы
      await handleUpdateWithSchema(update, botId, schema, decryptedToken);
    }

    // Всегда возвращаем 200 OK для Telegram
    res.status(200).json({ status: 'ok' });

  } catch (error) {
    console.error('❌ Error processing webhook:', error);
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
  botToken: string
): Promise<void> {
  // Обработка callback_query (нажатие на кнопку)
  if (update.callback_query) {
    const chatId = update.callback_query.message?.chat.id;
    const userId = update.callback_query.from.id;
    const callbackData = update.callback_query.data;
    const callbackQueryId = update.callback_query.id;

    if (!chatId || !userId || !callbackData) {
      console.error('❌ Missing data in callback_query');
      return;
    }

    console.log(`🔘 Callback from user ${userId}: ${callbackData}`);

    // Проверяем, что состояние существует в схеме
    if (!schema.states[callbackData]) {
      console.error(`❌ State ${callbackData} not found in schema`);
      try {
        await answerCallbackQuery(botToken, callbackQueryId, 'Ошибка: состояние не найдено');
      } catch (error) {
        console.error('Failed to answer callback query:', error);
      }
      return;
    }

    // Обновляем состояние пользователя
    await setUserState(botId, userId, callbackData);

    // Отправляем сообщение и кнопки для нового состояния
    await sendStateMessage(botToken, chatId, callbackData, schema);

    // Отвечаем на callback
    try {
      await answerCallbackQuery(botToken, callbackQueryId);
    } catch (error) {
      console.error('Failed to answer callback query:', error);
    }

    return;
  }

  // Обработка обычного сообщения
  if (update.message) {
    const chatId = update.message.chat.id;
    const userId = update.message.from?.id;
    const messageText = update.message.text || '';

    if (!userId) {
      console.error('❌ User ID not found in message');
      return;
    }

    console.log(`💬 Message from user ${userId} in chat ${chatId}: ${messageText.substring(0, 50)}...`);

    // Получаем текущее состояние пользователя
    let currentState = await getUserState(botId, userId);

    // Если состояние не установлено или не существует, используем начальное
    if (!currentState || !schema.states[currentState]) {
      currentState = schema.initialState;
      await setUserState(botId, userId, currentState);
    }

    // Отправляем сообщение и кнопки для текущего состояния
    await sendStateMessage(botToken, chatId, currentState, schema);
  }
}

/**
 * Отправить сообщение и кнопки для состояния
 */
async function sendStateMessage(
  botToken: string,
  chatId: number,
  stateKey: string,
  schema: BotSchema
): Promise<void> {
  const state = schema.states[stateKey];
  
  if (!state) {
    console.error(`❌ State ${stateKey} not found in schema`);
    return;
  }

  try {
    if (state.buttons && state.buttons.length > 0) {
      // Отправляем сообщение с кнопками
      await sendTelegramMessageWithKeyboard(botToken, chatId, state.message, state.buttons);
      console.log(`✅ State message sent with ${state.buttons.length} buttons`);
    } else {
      // Отправляем простое сообщение без кнопок
      await sendTelegramMessage(botToken, chatId, state.message);
      console.log(`✅ State message sent without buttons`);
    }
  } catch (error) {
    console.error(`❌ Failed to send state message:`, error);
    throw error;
  }
}

// Обработка ошибок
app.use((err: Error, req: Request, res: Response, next: any) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message,
  });
});

// Обработка 404
app.use((req: Request, res: Response) => {
  console.log(`❌ Route not found: ${req.method} ${req.path}`);
  res.status(404).json({ error: 'Route not found' });
});

// Запуск сервера
startServer().catch((error) => {
  console.error('Failed to start router server:', error);
});

// Graceful shutdown
async function shutdown() {
  console.log('🛑 Shutting down gracefully...');
  
  if (server) {
    server.close(() => {
      console.log('✅ HTTP server closed');
    });
  }
  
  await closePostgres();
  console.log('✅ PostgreSQL pool closed');
  
  await closeRedis();
  console.log('✅ Redis connection closed');
  
  process.exit(0);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

