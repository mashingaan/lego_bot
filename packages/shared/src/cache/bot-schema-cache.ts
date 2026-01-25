import type { BotSchema } from '../types/bot-schema';

export const SCHEMA_CACHE_TTL_SECONDS = 5 * 60;
const schemaKey = (botId: string) => `bot:${botId}:schema`;

export type LoggerLike = {
  error?: (ctx: any, msg?: string) => void;
  warn?: (ctx: any, msg?: string) => void;
  debug?: (ctx: any, msg?: string) => void;
};

export type RedisClientLike = {
  get: (key: string) => Promise<string | null>;
  setEx: (key: string, ttlSeconds: number, value: string) => Promise<any>;
  del: (key: string) => Promise<any>;
};

export interface CachedBotSchemaPayload {
  schema: BotSchema;
  schema_version: number;
}

export async function getCachedBotSchema(
  client: RedisClientLike,
  botId: string,
  logger?: LoggerLike
): Promise<CachedBotSchemaPayload | null> {
  try {
    const cached = await client.get(schemaKey(botId));
    if (!cached) return null;
    return JSON.parse(cached) as CachedBotSchemaPayload;
  } catch (error) {
    logger?.error?.({ service: 'redis', operation: 'getCachedBotSchema', botId, error }, 'Error getting cached schema');
    return null;
  }
}

export async function setCachedBotSchema(
  client: RedisClientLike,
  botId: string,
  payload: CachedBotSchemaPayload,
  logger?: LoggerLike
): Promise<void> {
  try {
    await client.setEx(schemaKey(botId), SCHEMA_CACHE_TTL_SECONDS, JSON.stringify(payload));
  } catch (error) {
    logger?.error?.({ service: 'redis', operation: 'setCachedBotSchema', botId, error }, 'Error caching schema');
  }
}

export async function invalidateBotSchemaCache(
  client: RedisClientLike,
  botId: string,
  logger?: LoggerLike
): Promise<void> {
  try {
    await client.del(schemaKey(botId));
  } catch (error) {
    logger?.error?.({ service: 'redis', operation: 'invalidateBotSchemaCache', botId, error }, 'Error invalidating schema cache');
  }
}
