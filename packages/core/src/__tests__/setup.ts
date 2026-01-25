import { afterAll, beforeAll } from 'vitest';
import { GenericContainer, PostgreSqlContainer, type StartedTestContainer } from 'testcontainers';
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
    const postgres = await new PostgreSqlContainer('postgres:15')
      .withDatabase('test_db')
      .withUsername('postgres')
      .withPassword('test_password')
      .start();
    postgresContainer = postgres;
    process.env.DATABASE_URL = postgres.getConnectionUri();
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
