import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import supertest from 'supertest';
import { RATE_LIMITS, WEBHOOK_LIMITS, createLogger } from '@dialogue-constructor/shared';
import { createApp } from '../index';
import { encryptToken } from '../utils/encryption';
import { initPostgres, closePostgres } from '../db/postgres';
import {
  getRedisClientOptional,
  getUserState,
  initRedis,
  closeRedis,
  setUserState,
} from '../db/redis';
import { createTestPostgresPool, cleanupTestDatabase, seedTestData } from '../../../shared/src/test-utils/db-helpers';
import { createMockBotSchema, createMockTelegramUpdate } from '../../../shared/src/test-utils/mock-factories';

vi.mock('../services/telegram', () => ({
  sendTelegramMessage: vi.fn().mockResolvedValue({}),
  sendTelegramMessageWithKeyboard: vi.fn().mockResolvedValue({}),
  answerCallbackQuery: vi.fn().mockResolvedValue({}),
}));

import {
  sendTelegramMessage,
  sendTelegramMessageWithKeyboard,
  answerCallbackQuery,
} from '../services/telegram';

const app = createApp();
const request = supertest(app);
const encryptionKey = process.env.ENCRYPTION_KEY as string;
let pool: ReturnType<typeof createTestPostgresPool>;

const validBotId = '11111111-1111-1111-1111-111111111111';
const webhookSecret = 'test-secret';

async function flushRedis() {
  const client = await getRedisClientOptional();
  if (client) {
    await client.flushDb();
  }
}

async function sendWebhook(body: any, secret = webhookSecret, botId = validBotId) {
  return request
    .post(`/webhook/${botId}`)
    .set('x-telegram-bot-api-secret-token', secret)
    .send(body);
}

beforeAll(async () => {
  pool = createTestPostgresPool();
  const logger = createLogger('router-test');
  await initPostgres(logger);
  await initRedis(logger);
});

beforeEach(async () => {
  await cleanupTestDatabase(pool);
  await flushRedis();
  vi.clearAllMocks();
});

afterAll(async () => {
  await pool.end();
  await closePostgres();
  await closeRedis();
});

describe('POST /webhook/:botId validation', () => {
  it('returns 400 for invalid botId', async () => {
    const response = await request
      .post('/webhook/not-a-uuid')
      .send(createMockTelegramUpdate());

    expect(response.status).toBe(400);
  });

  it('returns 401 when missing secret header', async () => {
    const response = await request
      .post(`/webhook/${validBotId}`)
      .send(createMockTelegramUpdate());

    expect(response.status).toBe(401);
  });

  it('returns 401 when secret invalid', async () => {
    await seedTestData(pool, [
      {
        id: validBotId,
        userId: 1,
        token: encryptToken('token', encryptionKey),
        name: 'Bot',
        webhookSecret,
      },
    ]);

    const response = await sendWebhook(createMockTelegramUpdate(), 'wrong-secret');

    expect(response.status).toBe(401);
  });

  it('returns 404 when bot not found', async () => {
    const response = await sendWebhook(createMockTelegramUpdate());

    expect(response.status).toBe(404);
  });

  it('returns 413 when payload too large', async () => {
    await seedTestData(pool, [
      {
        id: validBotId,
        userId: 1,
        token: encryptToken('token', encryptionKey),
        name: 'Bot',
        webhookSecret,
      },
    ]);

    const largePayload = Buffer.alloc(WEBHOOK_LIMITS.MAX_PAYLOAD_SIZE + 1);
    const response = await request
      .post(`/webhook/${validBotId}`)
      .set('x-telegram-bot-api-secret-token', webhookSecret)
      .send(largePayload);

    expect(response.status).toBe(413);
  });
});

describe('POST /webhook/:botId handling', () => {
  it('sends initial state message and stores state', async () => {
    await seedTestData(pool, [
      {
        id: validBotId,
        userId: 1,
        token: encryptToken('token', encryptionKey),
        name: 'Bot',
        webhookSecret,
        schema: createMockBotSchema(),
      },
    ]);

    const response = await sendWebhook(createMockTelegramUpdate());

    expect(response.status).toBe(200);
    expect(sendTelegramMessageWithKeyboard).toHaveBeenCalled();

    const state = await getUserState(validBotId, 1);
    expect(state).toBe('start');
  });

  it('sends message without buttons when state has no buttons', async () => {
    await seedTestData(pool, [
      {
        id: validBotId,
        userId: 1,
        token: encryptToken('token', encryptionKey),
        name: 'Bot',
        webhookSecret,
        schema: createMockBotSchema(),
      },
    ]);
    await setUserState(validBotId, 1, 'next');

    const response = await sendWebhook(createMockTelegramUpdate());

    expect(response.status).toBe(200);
    expect(sendTelegramMessage).toHaveBeenCalled();
  });

  it('handles callback_query transitions', async () => {
    await seedTestData(pool, [
      {
        id: validBotId,
        userId: 1,
        token: encryptToken('token', encryptionKey),
        name: 'Bot',
        webhookSecret,
        schema: createMockBotSchema(),
      },
    ]);

    const update = {
      update_id: 2,
      callback_query: {
        id: 'cb-1',
        from: { id: 1, is_bot: false, first_name: 'Test' },
        message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: 1, type: 'private' } },
        data: 'next',
      },
    };

    const response = await sendWebhook(update);

    expect(response.status).toBe(200);
    expect(answerCallbackQuery).toHaveBeenCalled();
    expect(sendTelegramMessage).toHaveBeenCalled();

    const state = await getUserState(validBotId, 1);
    expect(state).toBe('next');
  });

  it('handles callback_query with missing state', async () => {
    await seedTestData(pool, [
      {
        id: validBotId,
        userId: 1,
        token: encryptToken('token', encryptionKey),
        name: 'Bot',
        webhookSecret,
        schema: createMockBotSchema(),
      },
    ]);

    const update = {
      update_id: 3,
      callback_query: {
        id: 'cb-2',
        from: { id: 1, is_bot: false, first_name: 'Test' },
        message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: 1, type: 'private' } },
        data: 'missing',
      },
    };

    const response = await sendWebhook(update);

    expect(response.status).toBe(200);
    expect(answerCallbackQuery).toHaveBeenCalled();
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('sends default message when schema missing', async () => {
    await seedTestData(pool, [
      {
        id: validBotId,
        userId: 1,
        token: encryptToken('token', encryptionKey),
        name: 'Bot',
        webhookSecret,
      },
    ]);

    const response = await sendWebhook(createMockTelegramUpdate());

    expect(response.status).toBe(200);
    expect(sendTelegramMessage).toHaveBeenCalled();
  });
});

describe('POST /webhook/:botId rate limiting', () => {
  it('enforces per-bot limit', async () => {
    await seedTestData(pool, [
      {
        id: validBotId,
        userId: 1,
        token: encryptToken('token', encryptionKey),
        name: 'Bot',
        webhookSecret,
        schema: createMockBotSchema(),
      },
    ]);

    const responses = [];
    for (let i = 0; i < RATE_LIMITS.WEBHOOK_PER_BOT.max + 1; i += 1) {
      responses.push(await sendWebhook(createMockTelegramUpdate({ update_id: i + 1 })));
    }

    const lastResponse = responses[responses.length - 1];
    expect(lastResponse.status).toBe(429);
  });

  it('enforces global limit', async () => {
    const botA = '22222222-2222-2222-2222-222222222222';
    const botB = '33333333-3333-3333-3333-333333333333';
    await seedTestData(pool, [
      {
        id: botA,
        userId: 1,
        token: encryptToken('token-a', encryptionKey),
        name: 'Bot A',
        webhookSecret,
        schema: createMockBotSchema(),
      },
      {
        id: botB,
        userId: 1,
        token: encryptToken('token-b', encryptionKey),
        name: 'Bot B',
        webhookSecret,
        schema: createMockBotSchema(),
      },
    ]);

    const responses = [];
    for (let i = 0; i < RATE_LIMITS.WEBHOOK_GLOBAL.max + 1; i += 1) {
      const targetBot = i % 2 === 0 ? botA : botB;
      responses.push(await sendWebhook(createMockTelegramUpdate({ update_id: i + 10 }), webhookSecret, targetBot));
    }

    const lastResponse = responses[responses.length - 1];
    expect(lastResponse.status).toBe(429);
  });
});

describe('POST /webhook/:botId redis fallback', () => {
  it('stores state in memory when redis is unavailable', async () => {
    vi.resetModules();
    const inMemoryStates = new Map<string, { state: string; expiresAt: number }>();

    vi.doMock('../db/redis', async () => {
      const actual = await vi.importActual<typeof import('../db/redis')>('../db/redis');
      return {
        ...actual,
        getRedisClientOptional: vi.fn().mockResolvedValue(null),
        initRedis: vi.fn().mockResolvedValue(null),
        getUserState: vi.fn(async (botId: string, userId: number) => {
          const key = `bot:${botId}:user:${userId}:state`;
          const entry = inMemoryStates.get(key);
          if (!entry) {
            return null;
          }
          if (entry.expiresAt <= Date.now()) {
            inMemoryStates.delete(key);
            return null;
          }
          return entry.state;
        }),
        setUserState: vi.fn(async (botId: string, userId: number, state: string) => {
          const key = `bot:${botId}:user:${userId}:state`;
          inMemoryStates.set(key, { state, expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 });
        }),
        resetUserState: vi.fn(async (botId: string, userId: number) => {
          const key = `bot:${botId}:user:${userId}:state`;
          inMemoryStates.delete(key);
        }),
        getInMemoryStateStats: vi.fn(() => ({
          count: inMemoryStates.size,
          maxSize: 10000,
        })),
      };
    });

    const { createApp: createFallbackApp } = await import('../index');
    const fallbackRequest = supertest(createFallbackApp());

    const botId = '44444444-4444-4444-4444-444444444444';
    await seedTestData(pool, [
      {
        id: botId,
        userId: 1,
        token: encryptToken('token-fallback', encryptionKey),
        name: 'Fallback Bot',
        webhookSecret,
        schema: createMockBotSchema(),
      },
    ]);

    const response = await fallbackRequest
      .post(`/webhook/${botId}`)
      .set('x-telegram-bot-api-secret-token', webhookSecret)
      .send(createMockTelegramUpdate());

    expect(response.status).toBe(200);

    const healthResponse = await fallbackRequest.get('/health');
    expect(healthResponse.status).toBe(200);
    expect(healthResponse.body.inMemoryStates.count).toBeGreaterThan(0);

    vi.doUnmock('../db/redis');
  });
});
