import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import supertest from 'supertest';
import crypto from 'crypto';
import { BOT_LIMITS, RATE_LIMITS } from '@dialogue-constructor/shared';
import { createApp } from '../index';
import { encryptToken } from '../utils/encryption';
import * as redisModule from '../db/redis';
import { setRedisUnavailableForTests } from '../db/redis';
import { createTestPostgresPool, cleanupTestDatabase, seedTestData } from '../../../shared/src/test-utils/db-helpers';
import { authenticateRequest, buildTelegramInitData } from '../../../shared/src/test-utils/api-helpers';
import { createMockBotSchema } from '../../../shared/src/test-utils/mock-factories';

const app = createApp();
const request = supertest.agent(app);
let pool: ReturnType<typeof createTestPostgresPool>;
const encryptionKey = process.env.ENCRYPTION_KEY as string;
const botToken = process.env.BOT_TOKEN || 'test-bot-token';

async function flushRedis() {
  const client = await redisModule.getRedisClientOptional();
  if (client) {
    await client.flushDb();
  }
}

function makeValidBotToken(seed: string) {
  const safe = seed.replace(/[^A-Za-z0-9_-]/g, 'a');
  const padded = (safe + 'a'.repeat(35)).slice(0, 35);
  return `123456:${padded}`;
}

async function createBotApi(userId: number, token: string, name = 'Bot') {
  return authenticateRequest(
    request.post('/api/bots').send({ token, name }),
    userId,
    botToken
  );
}

async function updateSchemaApi(userId: number, botId: string, schema: any) {
  return authenticateRequest(
    request.put(`/api/bot/${botId}/schema`).send(schema),
    userId
  );
}

async function deleteBotApi(userId: number, botId: string) {
  return authenticateRequest(
    request.delete(`/api/bot/${botId}`),
    userId
  );
}

beforeEach(async () => {
  await cleanupTestDatabase(pool);
  await flushRedis();
});

beforeAll(async () => {
  process.env.BOT_TOKEN = botToken;
  pool = createTestPostgresPool();

  const { initializeRateLimiters } = await import('../index');
  await initializeRateLimiters();
});

afterAll(async () => {
  if (pool) {
    await pool.end();
  }
});

describe('POST /api/bots', () => {
  it('creates bot with valid data', async () => {
    const response = await createBotApi(1, makeValidBotToken('token-1'), 'Bot 1');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      name: 'Bot 1',
      webhook_set: false,
      schema_version: 0,
    });
    expect(response.body.id).toBeTruthy();
  });

  it('returns 400 on invalid token format', async () => {
    const response = await authenticateRequest(
      request.post('/api/bots').send({ token: 'invalid', name: 'Bot' }),
      1
    );

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation error');
  });

  it('returns 400 on invalid name', async () => {
    const response = await authenticateRequest(
      request.post('/api/bots').send({ token: makeValidBotToken('name'), name: '' }),
      1
    );

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation error');
  });

  it('returns 400 on too long name', async () => {
    const longName = 'a'.repeat(101);
    const response = await authenticateRequest(
      request.post('/api/bots').send({ token: makeValidBotToken('name-long'), name: longName }),
      1
    );

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation error');
  });

  it('returns 409 on duplicate token', async () => {
    await createBotApi(1, makeValidBotToken('dup-token'), 'Bot 1');
    const response = await createBotApi(1, makeValidBotToken('dup-token'), 'Bot 2');

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('Bot token already exists');
  });

  it('returns 429 when bot limit reached', async () => {
    const bots = Array.from({ length: BOT_LIMITS.MAX_BOTS_PER_USER }).map((_, index) => ({
      userId: 1,
      token: encryptToken(`token-${index}`, encryptionKey),
      name: `Bot ${index}`,
    }));
    await seedTestData(pool, bots);

    const response = await createBotApi(1, makeValidBotToken('new-token'), 'Overflow Bot');

    expect(response.status).toBe(429);
    expect(response.body.error).toBe('Bot limit reached');
  });

  it('enforces rate limiting for create bot', async () => {
    const response1 = await createBotApi(1, makeValidBotToken('rate-token-1'), 'Bot 1');
    const response2 = await createBotApi(1, makeValidBotToken('rate-token-2'), 'Bot 2');
    const response3 = await createBotApi(1, makeValidBotToken('rate-token-3'), 'Bot 3');

    expect(response1.status).toBe(200);
    expect(response2.status).toBe(200);
    expect(response3.status).toBe(429);
    expect(response3.body.error).toBe('Too many requests');
  });
});

describe('Authentication', () => {
  it('returns 401 without initData', async () => {
    const response = await request.get('/api/bots');

    expect(response.status).toBe(401);
  });

  it('returns 401 with invalid initData', async () => {
    const invalidInitData = buildTelegramInitData(1, 'wrong-token');
    const response = await request.get('/api/bots').set('X-Telegram-Init-Data', invalidInitData);

    expect(response.status).toBe(401);
  });

  it('returns 200 with valid initData', async () => {
    const response = await authenticateRequest(request.get('/api/bots'), 1);

    expect(response.status).toBe(200);
  });
});

describe('GET /api/bots', () => {
  it('returns empty list for new user', async () => {
    const response = await authenticateRequest(request.get('/api/bots'), 2);

    expect(response.status).toBe(200);
    expect(response.body.bots).toEqual([]);
  });

  it('returns bots for user and sorts by created_at desc', async () => {
    const bot1Id = crypto.randomUUID();
    const bot2Id = crypto.randomUUID();
    await seedTestData(pool, [
      {
        id: bot1Id,
        userId: 1,
        token: encryptToken('token-older', encryptionKey),
        name: 'Older Bot',
      },
      {
        id: bot2Id,
        userId: 1,
        token: encryptToken('token-newer', encryptionKey),
        name: 'Newer Bot',
      },
    ]);
    const older = new Date(Date.now() - 1000);
    const newer = new Date();
    await pool.query('UPDATE bots SET created_at = $1 WHERE id = $2', [older, bot1Id]);
    await pool.query('UPDATE bots SET created_at = $1 WHERE id = $2', [newer, bot2Id]);

    const response = await authenticateRequest(request.get('/api/bots'), 1);

    expect(response.status).toBe(200);
    expect(response.body.bots.length).toBe(2);
    expect(response.body.bots[0].id).toBe(bot2Id);
    expect(response.body.bots[1].id).toBe(bot1Id);
  });

  it('enforces rate limiting for API general', async () => {
    const responses = [];
    for (let i = 0; i < RATE_LIMITS.API_GENERAL.max + 1; i += 1) {
      responses.push(await authenticateRequest(request.get('/api/bots'), 1));
    }

    const lastResponse = responses[responses.length - 1];
    expect(lastResponse.status).toBe(429);
    expect(lastResponse.body.error).toBe('Too many requests');
  });
});

describe('GET /api/bot/:id', () => {
  it('returns bot by id', async () => {
    const botId = crypto.randomUUID();
    await seedTestData(pool, [
      {
        id: botId,
        userId: 1,
        token: encryptToken('token-1', encryptionKey),
        name: 'Bot 1',
      },
    ]);

    const response = await authenticateRequest(request.get(`/api/bot/${botId}`), 1);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(botId);
  });

  it('returns 404 for missing bot', async () => {
    const response = await authenticateRequest(request.get(`/api/bot/${crypto.randomUUID()}`), 1);

    expect(response.status).toBe(403);
  });

  it('returns 400 for invalid bot id', async () => {
    const response = await authenticateRequest(request.get('/api/bot/not-a-uuid'), 1);

    expect(response.status).toBe(400);
  });

  it('returns 403 for bot owned by another user', async () => {
    const botId = crypto.randomUUID();
    await seedTestData(pool, [
      {
        id: botId,
        userId: 2,
        token: encryptToken('token-2', encryptionKey),
        name: 'Bot 2',
      },
    ]);

    const response = await authenticateRequest(request.get(`/api/bot/${botId}`), 1);

    expect(response.status).toBe(403);
  });
});

describe('GET /api/bot/:id/schema', () => {
  it('returns schema when it exists', async () => {
    const botId = crypto.randomUUID();
    const schema = createMockBotSchema();
    await seedTestData(pool, [
      {
        id: botId,
        userId: 1,
        token: encryptToken('token-schema-read', encryptionKey),
        name: 'Schema Read Bot',
        schema,
      },
    ]);

    const response = await authenticateRequest(request.get(`/api/bot/${botId}/schema`), 1);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(schema);
  });

  it('returns 404 when bot is not found', async () => {
    const response = await authenticateRequest(
      request.get(`/api/bot/${crypto.randomUUID()}/schema`),
      1
    );

    expect(response.status).toBe(403);
  });

  it('returns 404 when schema is missing', async () => {
    const botId = crypto.randomUUID();
    await seedTestData(pool, [
      {
        id: botId,
        userId: 1,
        token: encryptToken('token-no-schema', encryptionKey),
        name: 'No Schema Bot',
        schema: null,
      },
    ]);

    const response = await authenticateRequest(request.get(`/api/bot/${botId}/schema`), 1);

    expect(response.status).toBe(404);
  });
});

describe('PUT /api/bot/:id/schema', () => {
  it('updates schema successfully', async () => {
    const botId = crypto.randomUUID();
    await seedTestData(pool, [
      {
        id: botId,
        userId: 1,
        token: encryptToken('token-schema', encryptionKey),
        name: 'Schema Bot',
      },
    ]);

    const schema = createMockBotSchema();
    const response = await updateSchemaApi(1, botId, schema);

    expect(response.status).toBe(200);
    expect(response.body.schema_version).toBe(1);
  });

  it('returns 400 for invalid schema', async () => {
    const botId = crypto.randomUUID();
    await seedTestData(pool, [
      {
        id: botId,
        userId: 1,
        token: encryptToken('token-invalid', encryptionKey),
        name: 'Invalid Bot',
      },
    ]);

    const invalidSchema = { version: 1, states: {} };
    const response = await updateSchemaApi(1, botId, invalidSchema);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation error');
  });

  it('returns 400 for invalid nextState', async () => {
    const botId = crypto.randomUUID();
    await seedTestData(pool, [
      {
        id: botId,
        userId: 1,
        token: encryptToken('token-next', encryptionKey),
        name: 'NextState Bot',
      },
    ]);

    const schema = {
      version: 1,
      initialState: 'start',
      states: {
        start: {
          message: 'Hello',
          buttons: [{ text: 'Go', nextState: 'missing' }],
        },
      },
    };
    const response = await updateSchemaApi(1, botId, schema);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid schema');
  });

  it('returns 400 when schema exceeds limits', async () => {
    const botId = crypto.randomUUID();
    await seedTestData(pool, [
      {
        id: botId,
        userId: 1,
        token: encryptToken('token-limits', encryptionKey),
        name: 'Limit Bot',
      },
    ]);

    const states: Record<string, { message: string }> = {};
    for (let i = 0; i < BOT_LIMITS.MAX_SCHEMA_STATES + 1; i += 1) {
      states[`state_${i}`] = { message: 'Hi' };
    }
    const schema = {
      version: 1,
      initialState: 'state_0',
      states,
    };
    const response = await updateSchemaApi(1, botId, schema);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Schema too large');
  });

  it('enforces rate limiting for schema update', async () => {
    const botId = crypto.randomUUID();
    await seedTestData(pool, [
      {
        id: botId,
        userId: 1,
        token: encryptToken('token-rate', encryptionKey),
        name: 'Rate Bot',
      },
    ]);

    const schema = createMockBotSchema();
    const response1 = await updateSchemaApi(1, botId, schema);
    const response2 = await updateSchemaApi(1, botId, schema);
    const response3 = await updateSchemaApi(1, botId, schema);

    expect(response1.status).toBe(200);
    expect(response2.status).toBe(200);
    expect(response3.status).toBe(429);
  });
});

describe('DELETE /api/bot/:id', () => {
  it('deletes bot successfully', async () => {
    const botId = crypto.randomUUID();
    await seedTestData(pool, [
      {
        id: botId,
        userId: 1,
        token: encryptToken('token-delete', encryptionKey),
        name: 'Delete Bot',
      },
    ]);

    const response = await deleteBotApi(1, botId);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('returns 404 for missing bot', async () => {
    const response = await deleteBotApi(1, crypto.randomUUID());

    expect(response.status).toBe(403);
  });

  it('returns 403 for bot owned by another user', async () => {
    const botId = crypto.randomUUID();
    await seedTestData(pool, [
      {
        id: botId,
        userId: 2,
        token: encryptToken('token-delete-other', encryptionKey),
        name: 'Other Bot',
      },
    ]);

    const response = await deleteBotApi(1, botId);

    expect(response.status).toBe(403);
  });
});

describe('Audit log', () => {
  it('records create_bot event', async () => {
    await createBotApi(1, makeValidBotToken('audit-create'), 'Audit Bot');
    const result = await pool.query('SELECT action FROM audit_logs WHERE action = $1', ['create_bot']);

    expect(result.rowCount).toBe(1);
  });

  it('records delete_bot event', async () => {
    const createResponse = await createBotApi(1, makeValidBotToken('audit-delete'), 'Audit Delete');
    await deleteBotApi(1, createResponse.body.id);

    const result = await pool.query('SELECT action FROM audit_logs WHERE action = $1', ['delete_bot']);
    expect(result.rowCount).toBe(1);
  });
});

describe('GET /health', () => {
  it('returns 200 when databases are available', async () => {
    await authenticateRequest(request.get('/api/bots'), 1);

    const response = await request.get('/health');

    expect(response.status).toBe(200);
    expect(response.body.databases).toBeTruthy();
    expect(response.body.circuitBreakers).toBeTruthy();
    expect(response.body.connectionPool).toBeTruthy();
    expect(response.body.retryStats).toBeTruthy();
  });

  it('returns 503 when postgres is not initialized', async () => {
    vi.resetModules();
    const freshModule = await import('../index');
    const freshRequest = supertest(freshModule.createApp());

    const response = await freshRequest.get('/health');

    expect(response.status).toBe(503);
  });

it('returns degraded when redis unavailable', async () => {
  try {
    setRedisUnavailableForTests(true);
    
    await authenticateRequest(request.get('/api/bots'), 1);
    const response = await request.get('/health');
    
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('degraded');
  } finally {
    setRedisUnavailableForTests(false);
  }
});
});
