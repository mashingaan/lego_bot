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
    await client.query('TRUNCATE TABLE bots CASCADE');
  } finally {
    if (!pool) {
      await client.end();
    }
  }
}

export async function seedTestData(pool: Pool, bots: SeedBot[] = []): Promise<void> {
  for (const bot of bots) {
    const id = bot.id ?? crypto.randomUUID();
    const webhookSet = bot.webhookSet ?? false;
    const schemaVersion = bot.schemaVersion ?? 0;
    const webhookSecret = bot.webhookSecret ?? null;
    const schemaValue = bot.schema ? JSON.stringify(bot.schema) : null;

    await pool.query(
      `INSERT INTO bots (id, user_id, token, name, webhook_set, schema, schema_version, webhook_secret)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, bot.userId, bot.token, bot.name, webhookSet, schemaValue, schemaVersion, webhookSecret]
    );
  }
}
