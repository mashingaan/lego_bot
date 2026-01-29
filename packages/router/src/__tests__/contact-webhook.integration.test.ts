process.env.NODE_ENV = 'test';
import { vi } from 'vitest';

vi.mock('../services/telegram', () => ({
  sendTelegramMessage: vi.fn().mockResolvedValue({}),
  sendTelegramMessageWithKeyboard: vi.fn().mockResolvedValue({}),
  sendTelegramMessageWithReplyKeyboard: vi.fn().mockResolvedValue({}),
  sendTelegramMessageWithReplyKeyboardRemove: vi.fn().mockResolvedValue({}),
  answerCallbackQuery: vi.fn().mockResolvedValue({}),
}));

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { createLogger } from '@dialogue-constructor/shared';
import { createApp } from '../index';
import { encryptToken } from '../utils/encryption';
import { initPostgres, closePostgres } from '../db/postgres';
import {
  getPendingInput,
  getRedisClientOptional,
  initRedis,
  closeRedis,
  getUserState,
  resetInMemoryStateForTests,
} from '../db/redis';
import { createTestPostgresPool, cleanupAllTestState, seedTestData } from '../../../shared/src/test-utils/db-helpers';

import {
  sendTelegramMessage,
  sendTelegramMessageWithReplyKeyboard,
  sendTelegramMessageWithReplyKeyboardRemove,
} from '../services/telegram';

const app = createApp();
const request = supertest(app);
const encryptionKey = process.env.ENCRYPTION_KEY as string;
let pool: ReturnType<typeof createTestPostgresPool>;

const validBotId = '55555555-5555-5555-5555-555555555555';
const webhookSecret = 'contact-secret';

async function sendWebhook(body: any, secret = webhookSecret, botId = validBotId) {
  return request
    .post(`/webhook/${botId}`)
    .set('x-telegram-bot-api-secret-token', secret)
    .send(body);
}

beforeAll(async () => {
  pool = createTestPostgresPool();
  const logger = createLogger('router-contact-test');
  await initPostgres(logger);
  await initRedis(logger);

  const { initializeRateLimiters } = await import('../index');
  await initializeRateLimiters();
});

beforeEach(async () => {
  const redisClient = await getRedisClientOptional();
  await cleanupAllTestState(pool, redisClient, resetInMemoryStateForTests);
  vi.clearAllMocks();
});

afterAll(async () => {
  if (pool) {
    await pool.end();
  }
  await closePostgres();
  await closeRedis();
});

describe('POST /webhook/:botId contact handling', () => {
  it('stores contact and transitions to next state', async () => {
    const schema = {
      version: 1,
      initialState: 'collect_contact',
      states: {
        collect_contact: {
          message: 'Please share your phone number',
          buttons: [
            {
              type: 'request_contact',
              text: 'Share phone',
              nextState: 'after_contact',
            },
          ],
        },
        after_contact: {
          message: 'Thanks!',
        },
      },
    };

    await seedTestData(pool, [
      {
        id: validBotId,
        userId: 1,
        token: encryptToken('token', encryptionKey),
        name: 'Contact Bot',
        webhookSecret,
        schema,
      },
    ]);

    const startUpdate = {
      update_id: 1,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 1, type: 'private' },
        from: { id: 1, is_bot: false, first_name: 'Test' },
        text: 'Start',
      },
    };

    const startResponse = await sendWebhook(startUpdate);
    expect(startResponse.status).toBe(200);
    expect(sendTelegramMessageWithReplyKeyboard).toHaveBeenCalled();

    const pending = await getPendingInput(validBotId, 1);
    expect(pending?.nextState).toBe('after_contact');
    expect(pending?.type).toBe('contact');

    const contactUpdate = {
      update_id: 2,
      message: {
        message_id: 2,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 1, type: 'private' },
        from: { id: 1, is_bot: false, first_name: 'Test' },
        contact: {
          phone_number: '+1234567890',
          first_name: 'Test',
          user_id: 1,
        },
      },
    };

    const contactResponse = await sendWebhook(contactUpdate);
    expect(contactResponse.status).toBe(200);
    expect(sendTelegramMessageWithReplyKeyboardRemove).toHaveBeenCalled();
    expect(sendTelegramMessage).toHaveBeenCalled();

    const dbResult = await pool.query(
      `SELECT phone_number, telegram_user_id::text as telegram_user_id
       FROM bot_users
       WHERE bot_id = $1`,
      [validBotId]
    );

    expect(dbResult.rows).toHaveLength(1);
    expect(dbResult.rows[0].phone_number).toBe('+1234567890');
    expect(dbResult.rows[0].telegram_user_id).toBe('1');

    const state = await getUserState(validBotId, 1);
    expect(state).toBe('after_contact');

    const pendingAfter = await getPendingInput(validBotId, 1);
    expect(pendingAfter).toBeNull();
  });
});
