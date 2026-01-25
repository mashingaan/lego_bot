/**
 * CRUD операции для таблицы bots
 * 
 * Боты хранятся в PostgreSQL с зашифрованными токенами.
 * Схемы диалогов хранятся в JSONB поле schema.
 */

import { Pool, PoolClient } from 'pg';
import { getPool, getPostgresClient } from './postgres';
import { BotSchema, WEBHOOK_LIMITS } from '@dialogue-constructor/shared';
import crypto from 'crypto';
import { logAuditEvent } from './audit-log';

export interface Bot {
  id: string;
  user_id: number;
  token: string;
  name: string;
  webhook_set: boolean;
  webhook_secret: string | null;
  schema: BotSchema | null;
  schema_version: number;
  created_at: Date;
  updated_at: Date;
}

export interface CreateBotData {
  user_id: number;
  token: string;
  name: string;
}

export interface AuditContext {
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Создать бота в базе данных
 */
export async function createBot(data: CreateBotData, context?: AuditContext): Promise<Bot> {
  const client = await getPostgresClient();

  // Генерация webhook secret
  const webhookSecret = crypto.randomBytes(WEBHOOK_LIMITS.SECRET_TOKEN_LENGTH).toString('hex');

  // Примечание: `SECRET_TOKEN_LENGTH` здесь фактически означает **байты**, а `.toString('hex')` удваивает длину строки.
  // Например, 32 байта -> 64 hex-символа. Опции: переименовать в `SECRET_TOKEN_BYTES` или генерировать base64url.

  try {
    const result = await client.query<Bot>(
      `INSERT INTO bots (user_id, token, name, webhook_set, schema, schema_version, webhook_secret)
       VALUES ($1, $2, $3, false, NULL, 0, $4)
       RETURNING id, user_id, token, name, webhook_set, schema, schema_version, webhook_secret, created_at, updated_at`,
      [data.user_id, data.token, data.name, webhookSecret]
    );
    
    const bot = result.rows[0];
    try {
      await logAuditEvent({
        userId: data.user_id,
        requestId: context?.requestId,
        action: 'create_bot',
        resourceType: 'bot',
        resourceId: bot.id,
        metadata: { name: data.name },
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
      });
    } catch (error) {
      console.error('Audit log failed:', error);
    }
    return bot;
  } finally {
    client.release();
  }
}

/**
 * Получить всех ботов пользователя
 */
export async function getBotsByUserId(userId: number): Promise<Bot[]> {
  console.log('🔍 getBotsByUserId - userId:', userId);
  
  try {
    const client = await getPostgresClient();
    console.log('✅ PostgreSQL client obtained');
    
    try {
      const result = await client.query<Bot>(
        `SELECT id, user_id, token, name, webhook_set, schema, schema_version, webhook_secret, created_at, updated_at
         FROM bots
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId]
      );
      
      console.log('✅ Query executed, rows:', result.rows.length);
      return result.rows;
    } catch (queryError) {
      console.error('❌ Query error:', queryError);
      throw queryError;
    } finally {
      client.release();
      console.log('✅ PostgreSQL client released');
    }
  } catch (error) {
    console.error('❌ getBotsByUserId error:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack');
    throw error;
  }
}

export interface CursorPaginationParams {
  limit: number;
  cursor?: string;
}

export interface PaginatedBots {
  bots: Bot[];
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
}

type BotCursor = { created_at: string; id: string };

function encodeCursor(cursor: BotCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64');
}

function decodeCursor(cursor?: string): BotCursor | null {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as BotCursor;
  } catch {
    return null;
  }
}

export async function getBotsByUserIdPaginated(
  userId: number,
  params: CursorPaginationParams
): Promise<PaginatedBots> {
  const client = await getPostgresClient();

  try {
    const limit = Math.min(Math.max(params.limit, 1), 100);
    const decoded = decodeCursor(params.cursor);

    const values: any[] = [userId, limit + 1];
    let where = 'WHERE user_id = $1';

    if (decoded) {
      values.push(decoded.created_at, decoded.id);
      where += ' AND (created_at, id) < ($3, $4)';
    }

    const result = await client.query<Bot>(
      `SELECT id, user_id, token, name, webhook_set, schema, schema_version, webhook_secret, created_at, updated_at
       FROM bots
       ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      values
    );

    const rows = result.rows;
    const hasMore = rows.length > limit;
    const bots = hasMore ? rows.slice(0, limit) : rows;

    const last = bots[bots.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ created_at: String((last as any).created_at), id: String((last as any).id) })
        : null;

    return { bots, nextCursor, hasMore };
  } finally {
    client.release();
  }
}

/**
 * Получить бота по ID
 */
export async function getBotById(botId: string, userId: number): Promise<Bot | null> {
  const client = await getPostgresClient();
  
  try {
    const result = await client.query<Bot>(
      `SELECT id, user_id, token, name, webhook_set, schema, schema_version, webhook_secret, created_at, updated_at
       FROM bots
       WHERE id = $1 AND user_id = $2`,
      [botId, userId]
    );
    
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

/**
 * Проверить, существует ли бот с таким токеном
 */
export async function botExistsByToken(token: string): Promise<boolean> {
  const client = await getPostgresClient();
  
  try {
    const result = await client.query(
      `SELECT 1 FROM bots WHERE token = $1 LIMIT 1`,
      [token]
    );
    
    return result.rows.length > 0;
  } finally {
    client.release();
  }
}

/**
 * Получить бота по webhook_secret
 */
export async function getBotByWebhookSecret(webhookSecret: string): Promise<Bot | null> {
  const client = await getPostgresClient();
  
  try {
    const result = await client.query<Bot>(
      `SELECT id, user_id, token, name, webhook_set, schema, schema_version, webhook_secret, created_at, updated_at
       FROM bots
       WHERE webhook_secret = $1`,
      [webhookSecret]
    );
    
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

/**
 * Получить бота по ID без проверки пользователя
 */
export async function getBotByIdAnyUser(botId: string): Promise<Bot | null> {
  const client = await getPostgresClient();

  try {
    const result = await client.query<Bot>(
      `SELECT id, user_id, token, name, webhook_set, schema, schema_version, webhook_secret, created_at, updated_at
       FROM bots
       WHERE id = $1`,
      [botId]
    );

    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

export async function setBotWebhookSecret(
  botId: string,
  userId: number,
  webhookSecret: string
): Promise<boolean> {
  const client = await getPostgresClient();

  try {
    const result = await client.query(
      `UPDATE bots
       SET webhook_secret = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND user_id = $3`,
      [webhookSecret, botId, userId]
    );

    return result.rowCount ? result.rowCount > 0 : false;
  } finally {
    client.release();
  }
}

/**
 * Удалить бота
 */
export async function deleteBot(botId: string, userId: number, context?: AuditContext): Promise<boolean> {
  const client = await getPostgresClient();
  
  try {
    const result = await client.query(
      `DELETE FROM bots WHERE id = $1 AND user_id = $2`,
      [botId, userId]
    );
    
    const deleted = result.rowCount ? result.rowCount > 0 : false;
    if (deleted) {
      try {
        await logAuditEvent({
          userId,
          requestId: context?.requestId,
          action: 'delete_bot',
          resourceType: 'bot',
          resourceId: botId,
          metadata: null,
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
        });
      } catch (error) {
        console.error('Audit log failed:', error);
      }
    }
    return deleted;
  } finally {
    client.release();
  }
}

/**
 * Обновить статус webhook для бота
 */
export async function updateWebhookStatus(
  botId: string,
  userId: number,
  webhookSet: boolean
): Promise<boolean> {
  const client = await getPostgresClient();
  
  try {
    const result = await client.query(
      `UPDATE bots 
       SET webhook_set = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND user_id = $3`,
      [webhookSet, botId, userId]
    );
    
    return result.rowCount ? result.rowCount > 0 : false;
  } finally {
    client.release();
  }
}

/**
 * Обновить схему бота
 */
export async function updateBotSchema(
  botId: string,
  userId: number,
  schema: BotSchema,
  context?: AuditContext
): Promise<boolean> {
  const client = await getPostgresClient();
  
  try {
    const result = await client.query(
      `UPDATE bots 
       SET schema = $1, schema_version = schema_version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND user_id = $3`,
      [JSON.stringify(schema), botId, userId]
    );
    
    const updated = result.rowCount ? result.rowCount > 0 : false;
    if (updated) {
      try {
        await logAuditEvent({
          userId,
          requestId: context?.requestId,
          action: 'update_schema',
          resourceType: 'schema',
          resourceId: botId,
          metadata: { statesCount: Object.keys(schema.states || {}).length },
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
        });
      } catch (error) {
        console.error('Audit log failed:', error);
      }
    }
    return updated;
  } finally {
    client.release();
  }
}

/**
 * SQL миграции (встроены в код для совместимости с Vercel serverless)
 */
const MIGRATIONS = {
  '001_create_bots_table': `
-- Создание таблицы bots
CREATE TABLE IF NOT EXISTS bots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id BIGINT NOT NULL,
    token TEXT NOT NULL,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Индекс для быстрого поиска по user_id
CREATE INDEX IF NOT EXISTS idx_bots_user_id ON bots(user_id);

-- Индекс для поиска по token (для проверки уникальности)
CREATE INDEX IF NOT EXISTS idx_bots_token ON bots(token);

-- Комментарии к таблице
COMMENT ON TABLE bots IS 'Таблица для хранения информации о созданных ботах';
COMMENT ON COLUMN bots.id IS 'Уникальный идентификатор бота (UUID)';
COMMENT ON COLUMN bots.user_id IS 'Telegram ID пользователя, создавшего бота';
COMMENT ON COLUMN bots.token IS 'Токен бота (зашифрованный)';
COMMENT ON COLUMN bots.name IS 'Название бота';
`,
  '002_add_webhook_set_column': `
-- Добавление поля webhook_set в таблицу bots
ALTER TABLE bots ADD COLUMN IF NOT EXISTS webhook_set BOOLEAN DEFAULT FALSE;

-- Комментарий к полю
COMMENT ON COLUMN bots.webhook_set IS 'Флаг, указывающий, настроен ли webhook для бота';
`,
  '003_add_schema_fields': `
-- Добавление полей для хранения схемы бота
ALTER TABLE bots ADD COLUMN IF NOT EXISTS schema JSONB DEFAULT NULL;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS schema_version INTEGER DEFAULT 0;

-- Комментарии к полям
COMMENT ON COLUMN bots.schema IS 'JSON схема диалогов бота (состояния, сообщения, кнопки)';
COMMENT ON COLUMN bots.schema_version IS 'Версия схемы для контроля изменений';

-- Индекс для поиска по schema (GIN индекс для JSONB)
CREATE INDEX IF NOT EXISTS idx_bots_schema ON bots USING GIN (schema);
`,
  '004_add_webhook_secret': `
-- Добавление поля webhook_secret для валидации webhook'ов
ALTER TABLE bots ADD COLUMN IF NOT EXISTS webhook_secret VARCHAR(64) DEFAULT NULL;

-- Индекс для быстрого поиска по webhook_secret
CREATE INDEX IF NOT EXISTS idx_bots_webhook_secret ON bots(webhook_secret);

COMMENT ON COLUMN bots.webhook_secret IS 'Secret token для валидации webhook запросов от Telegram';
`,
  '005_optimize_indexes': `
-- Индекс для списка ботов пользователя (ускоряет getBotsByUserId* + сортировку по created_at)
-- Примечание: (id) уже индексирован как PK, поэтому отдельные индексы на id и (id, user_id) обычно избыточны.
CREATE INDEX IF NOT EXISTS idx_bots_user_id_created_at ON bots(user_id, created_at DESC, id DESC);

-- (Опционально) добавлять только если реально есть запросы с фильтром по schema:
--   WHERE user_id = $1 AND schema IS NOT NULL
-- Тогда индекс должен соответствовать этому фильтру:
-- CREATE INDEX IF NOT EXISTS idx_bots_user_id_with_schema ON bots(user_id) WHERE schema IS NOT NULL;
`,
  '006_create_audit_logs': `
-- Создание таблицы audit_logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id BIGINT NOT NULL,
    request_id TEXT, -- correlation id (например req.id из логгера)
    action VARCHAR(50) NOT NULL, -- 'create_bot', 'delete_bot', 'update_schema'
    resource_type VARCHAR(50) NOT NULL, -- 'bot', 'schema'
    resource_id UUID,
    metadata JSONB, -- ограничивать размер на уровне кода (например <= 4KB после JSON.stringify)
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_request_id ON audit_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
`,
};

/**
 * Инициализация таблицы bots (создание таблицы если не существует)
 */
export async function initializeBotsTable(): Promise<void> {
  const pool = getPool();
  if (!pool) {
    throw new Error('PostgreSQL pool is not initialized');
  }

  // Применяем все миграции (встроены в код для совместимости с Vercel serverless)
  const migrationKeys = [
    '001_create_bots_table',
    '002_add_webhook_set_column',
    '003_add_schema_fields',
    '004_add_webhook_secret',
    '005_optimize_indexes',
    '006_create_audit_logs',
  ];
  
  for (const migrationKey of migrationKeys) {
    try {
      const migrationSQL = MIGRATIONS[migrationKey as keyof typeof MIGRATIONS];
      if (!migrationSQL) {
        throw new Error(`Migration ${migrationKey} not found`);
      }
      
      await pool.query(migrationSQL);
      console.log(`✅ Migration applied: ${migrationKey}`);
    } catch (error: any) {
      // Если ошибка связана с тем, что поле уже существует - это нормально
      if (error?.message?.includes('already exists') || error?.message?.includes('duplicate')) {
        console.log(`ℹ️  Migration ${migrationKey} already applied`);
      } else {
        console.error(`❌ Error applying migration ${migrationKey}:`, error);
        console.error('Error message:', error?.message);
        console.error('Error stack:', error?.stack);
        throw error;
      }
    }
  }
  
  console.log('✅ Bots table initialized');
}

