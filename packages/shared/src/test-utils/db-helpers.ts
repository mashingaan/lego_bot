/**
 * Test database helpers for integration tests.
 *
 * IMPORTANT: Test isolation requires proper cleanup order:
 * 1. Database cleanup (removes persistent state)
 * 2. Redis flush (removes cached state, rate limiter keys)
 * 3. In-memory state reset (clears fallback maps)
 *
 * IMPORTANT: cleanupAllTestState() uses Postgres `TRUNCATE` and (by default) Redis `FLUSHDB`. These operations are not safe when tests run in parallel (Vitest threads/workers) because they can wipe state for neighboring tests.
 *   - Preferred rule: run integration tests sequentially (e.g., vitest config, separate `test:integration` script with `--no-threads`, or `describe.sequential`).
 *   - Parallel-safe alternative: isolate Redis per worker (e.g., select a different Redis DB index per worker) so cleanup does not collide across workers.
 *
 * Redis note: `FLUSHDB` is appropriate only when Redis is a dedicated test instance (e.g., testcontainers). If Redis may point to a shared/local instance, prefer prefix-based cleanup (e.g., delete `rl:*` keys) as a safer fallback.
 *
 * Dotenv note: prefer setting `NODE_ENV=test` at process start (e.g., `cross-env NODE_ENV=test ...`) to avoid any import-order sensitivity. Per-file `process.env.NODE_ENV = 'test'` is fine as defense-in-depth.
 *
 * Use cleanupAllTestState() in beforeEach hooks to ensure complete isolation.
 *
 * Testcontainers setup:
 * - Set NODE_ENV='test' BEFORE any imports in test files
 * - Do NOT set DATABASE_URL in .env for tests
 * - Testcontainers will auto-start if DATABASE_URL is unset
 */

import { Pool } from 'pg';
import crypto from 'crypto';

export type SeedBot = {
  id?: string;
  userId: number;
  token: string;
  name: string;
  webhookSet?: boolean;
  schema?: unknown;
  schemaVersion?: number;
  webhookSecret?: string | null;
};

export function createTestPostgresPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  return new Pool({ connectionString });
}

export async function cleanupTestDatabase(pool?: Pool): Promise<void> {
  const client = pool ?? createTestPostgresPool();
  try {
    // Truncate in dependency order (children first, then parents)
    await client.query('TRUNCATE TABLE broadcast_messages CASCADE');
    await client.query('TRUNCATE TABLE bot_broadcasts CASCADE');
    await client.query('TRUNCATE TABLE bot_analytics CASCADE');
    await client.query('TRUNCATE TABLE webhook_logs CASCADE');
    await client.query('TRUNCATE TABLE bot_users CASCADE');
    await client.query('TRUNCATE TABLE audit_logs CASCADE');
    await client.query('TRUNCATE TABLE bots RESTART IDENTITY CASCADE');
  } finally {
    if (!pool) {
      await client.end();
    }
  }
}

/**
 * Complete test cleanup: database, Redis, and in-memory state.
 * Call this in beforeEach hooks to ensure full test isolation.
 *
 * @param pool - Postgres pool for database cleanup
 * @param redisClient - Optional Redis client for flushing (pass result of getRedisClientOptional())
 * @param resetInMemoryFn - Optional function to reset in-memory state (e.g., resetInMemoryStateForTests from redis module)
 */
export async function cleanupAllTestState(
  pool: Pool,
  redisClient?: { flushDb: () => Promise<unknown> } | null,
  resetInMemoryFn?: () => void
): Promise<void> {
  // 1. Clean database first (removes persistent state)
  await cleanupTestDatabase(pool);

  // 2. Flush Redis (removes cached state, rate limiter keys)
  if (redisClient) {
    await redisClient.flushDb();
  }

  // 3. Reset in-memory fallback state (user states, pending inputs, dedup maps)
  if (resetInMemoryFn) {
    resetInMemoryFn();
  }
}

export async function seedTestData(pool: Pool, bots: SeedBot[] = []): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const bot of bots) {
      const id = bot.id ?? crypto.randomUUID();
      const webhookSet = bot.webhookSet ?? false;
      const schemaVersion = bot.schemaVersion ?? 0;
      const webhookSecret = bot.webhookSecret ?? null;
      const schemaValue = bot.schema ? JSON.stringify(bot.schema) : null;

      await client.query(
        `INSERT INTO bots (id, user_id, token, name, webhook_set, schema, schema_version, webhook_secret)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, bot.userId, bot.token, bot.name, webhookSet, schemaValue, schemaVersion, webhookSecret]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
