// @vitest-environment node
// Run tests sequentially to avoid race conditions
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import { createBot } from '../bots';
import { getPostgresClient } from '../postgres';
import { createOrUpdateBotUser, getBotUsers, getBotUserStats } from '../bot-users';

const TEST_RUN_ID = crypto.randomUUID();
const USER_ID_BASE = Number.parseInt(TEST_RUN_ID.replace(/-/g, '').slice(0, 10), 16);

let userIdCounter = 0;
let currentUserId = USER_ID_BASE;
const createdBotIds: string[] = [];

async function cleanupDatabase(userId: number, botIds: string[]): Promise<void> {
  const client = await getPostgresClient();
  try {
    if (botIds.length > 0) {
      await client.query('DELETE FROM bot_users WHERE bot_id = ANY($1::uuid[])', [botIds]);
    }
    await client.query('DELETE FROM bots WHERE user_id = $1', [userId]);
  } finally {
    client.release();
  }
}

async function createTestBot(token: string, name: string) {
  const bot = await createBot({ user_id: currentUserId, token, name });
  createdBotIds.push(bot.id);
  // Verify bot exists in database
  const client = await getPostgresClient();
  try {
    const result = await client.query('SELECT id FROM bots WHERE id = $1', [bot.id]);
    if (result.rows.length === 0) {
      throw new Error(`Bot ${bot.id} was not found in database after creation`);
    }
  } finally {
    client.release();
  }
  return bot;
}

beforeEach(async () => {
  // IMPORTANT: run cleanup *before* resetting/overwriting currentUserId/createdBotIds,
  // otherwise cleanupDatabase may be called with a new user_id and an empty createdBotIds array.
  if (currentUserId != null) {
    await cleanupDatabase(currentUserId, createdBotIds);
  }
  currentUserId = USER_ID_BASE + userIdCounter;
  userIdCounter += 1;
  createdBotIds.length = 0;
});

afterEach(async () => {
  await cleanupDatabase(currentUserId, createdBotIds);
});

describe('bot users CRUD operations', () => {
  it('creates and updates bot user records', async () => {
    const bot = await createTestBot('token', 'Bot');
    const telegramUserId = '9007199254740993';

    const created = await createOrUpdateBotUser(bot.id, telegramUserId, {
      first_name: 'Alice',
      username: 'alice',
      phone_number: null,
    });

    expect(created.id).toBeTruthy();
    expect(created.telegram_user_id).toBe(telegramUserId);
    expect(created.first_name).toBe('Alice');
    expect(created.username).toBe('alice');
    expect(created.interaction_count).toBe(1);

    const firstInteraction = new Date(created.last_interaction_at).getTime();
    await new Promise((resolve) => setTimeout(resolve, 5));

    const updated = await createOrUpdateBotUser(bot.id, telegramUserId, {
      last_name: 'Doe',
      phone_number: '+1234567890',
    });

    expect(updated.interaction_count).toBe(2);
    expect(updated.phone_number).toBe('+1234567890');
    expect(new Date(updated.last_interaction_at).getTime()).toBeGreaterThanOrEqual(firstInteraction);
  });

  it('returns paginated bot users', async () => {
    const bot = await createTestBot('token', 'Bot');

    await createOrUpdateBotUser(bot.id, '1001', { first_name: 'One' });
    await createOrUpdateBotUser(bot.id, '1002', { first_name: 'Two' });
    await createOrUpdateBotUser(bot.id, '1003', { first_name: 'Three' });

    const firstPage = await getBotUsers(bot.id, currentUserId, { limit: 2 });
    expect(firstPage.users).toHaveLength(2);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toBeTruthy();
    expect(firstPage.users.every((user) => typeof user.telegram_user_id === 'string')).toBe(true);

    const secondPage = await getBotUsers(bot.id, currentUserId, {
      limit: 2,
      cursor: firstPage.nextCursor ?? undefined,
    });
    expect(secondPage.users).toHaveLength(1);
    expect(secondPage.hasMore).toBe(false);

    const allIds = [...firstPage.users, ...secondPage.users].map((user) => user.telegram_user_id).sort();
    expect(allIds).toEqual(['1001', '1002', '1003']);
  });

  it('returns bot user stats', async () => {
    const bot = await createTestBot('token', 'Bot');

    await createOrUpdateBotUser(bot.id, '2001', { first_name: 'NoPhone' });
    await createOrUpdateBotUser(bot.id, '2002', { first_name: 'HasPhone', phone_number: '+111' });

    const stats = await getBotUserStats(bot.id, currentUserId);

    expect(stats.total).toBe(2);
    expect(stats.newLast7Days).toBe(2);
    expect(stats.conversionRate).toBeCloseTo(0.5, 5);
  });

  it('enforces ownership when fetching bot users', async () => {
    const bot = await createTestBot('token', 'Bot');
    await createOrUpdateBotUser(bot.id, '3001', { first_name: 'Owner' });

    const otherUserId = currentUserId + 9999;
    const result = await getBotUsers(bot.id, otherUserId, { limit: 10 });

    expect(result.users).toHaveLength(0);
    expect(result.hasMore).toBe(false);
  });
});
