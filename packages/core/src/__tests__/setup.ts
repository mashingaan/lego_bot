import { afterAll, beforeAll } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { createLogger } from '@dialogue-constructor/shared';
import { initPostgres, closePostgres } from '../db/postgres';
import { initializeBotsTable } from '../db/bots';
import { initRedis, closeRedis } from '../db/redis';

let postgresContainer: StartedTestContainer | null = null;
let redisContainer: StartedTestContainer | null = null;

process.env.NODE_ENV = 'test';
if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = 'test_encryption_key_32_chars_long';
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    try {
      const postgres = await new GenericContainer('postgres:15')
        .withExposedPorts(5432)
        .withEnvironment({
          POSTGRES_DB: 'test_db',
          POSTGRES_USER: 'postgres',
          POSTGRES_PASSWORD: 'test_password',
        })
        .start();
      postgresContainer = postgres;
      process.env.DATABASE_URL = `postgresql://postgres:test_password@${postgres.getHost()}:${postgres.getMappedPort(5432)}/test_db`;
    } catch {
      throw new Error('Docker required for integration tests or set DATABASE_URL');
    }
  }

  if (!process.env.REDIS_URL) {
    const redis = await new GenericContainer('redis:7')
      .withExposedPorts(6379)
      .start();
    redisContainer = redis;
    process.env.REDIS_URL = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
  }

  const logger = createLogger('test-setup');
  await initPostgres(logger);
  await initializeBotsTable();
  await initRedis(logger);
}, 60000);

afterAll(async () => {
  await closePostgres();
  await closeRedis();

  if (postgresContainer) {
    await postgresContainer.stop();
    postgresContainer = null;
  }
  if (redisContainer) {
    await redisContainer.stop();
    redisContainer = null;
  }
}, 60000);
