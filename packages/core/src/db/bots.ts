/**
 * CRUD операции для таблицы bots
 * 
 * Боты хранятся в PostgreSQL с зашифрованными токенами.
 * Схемы диалогов хранятся в JSONB поле schema.
 */

import { Pool, PoolClient } from 'pg';
import { getPool, getPostgresClient } from './postgres';
import { BotSchema } from '@dialogue-constructor/shared';

export interface Bot {
  id: string;
  user_id: number;
  token: string;
  name: string;
  webhook_set: boolean;
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

/**
 * Создать бота в базе данных
 */
export async function createBot(data: CreateBotData): Promise<Bot> {
  const client = await getPostgresClient();
  
  try {
    const result = await client.query<Bot>(
      `INSERT INTO bots (user_id, token, name, webhook_set, schema, schema_version)
       VALUES ($1, $2, $3, false, NULL, 0)
       RETURNING id, user_id, token, name, webhook_set, schema, schema_version, created_at, updated_at`,
      [data.user_id, data.token, data.name]
    );
    
    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Получить всех ботов пользователя
 */
export async function getBotsByUserId(userId: number): Promise<Bot[]> {
  const client = await getPostgresClient();
  
  try {
    const result = await client.query<Bot>(
      `SELECT id, user_id, token, name, webhook_set, schema, schema_version, created_at, updated_at
       FROM bots
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
    
    return result.rows;
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
      `SELECT id, user_id, token, name, webhook_set, schema, schema_version, created_at, updated_at
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
 * Удалить бота
 */
export async function deleteBot(botId: string, userId: number): Promise<boolean> {
  const client = await getPostgresClient();
  
  try {
    const result = await client.query(
      `DELETE FROM bots WHERE id = $1 AND user_id = $2`,
      [botId, userId]
    );
    
    return result.rowCount ? result.rowCount > 0 : false;
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
  schema: BotSchema
): Promise<boolean> {
  const client = await getPostgresClient();
  
  try {
    const result = await client.query(
      `UPDATE bots 
       SET schema = $1, schema_version = schema_version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND user_id = $3`,
      [JSON.stringify(schema), botId, userId]
    );
    
    return result.rowCount ? result.rowCount > 0 : false;
  } finally {
    client.release();
  }
}

/**
 * Инициализация таблицы bots (создание таблицы если не существует)
 */
export async function initializeBotsTable(): Promise<void> {
  const pool = getPool();
  if (!pool) {
    throw new Error('PostgreSQL pool is not initialized');
  }

  const fs = require('fs');
  const path = require('path');
  
  // Применяем все миграции
  const migrations = [
    '001_create_bots_table.sql',
    '002_add_webhook_set_column.sql',
    '003_add_schema_fields.sql',
  ];
  
  for (const migrationFile of migrations) {
    try {
      const migrationPath = path.join(__dirname, 'migrations', migrationFile);
      const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
      await pool.query(migrationSQL);
      console.log(`✅ Migration applied: ${migrationFile}`);
    } catch (error: any) {
      // Если ошибка связана с тем, что поле уже существует - это нормально
      if (error?.message?.includes('already exists') || error?.message?.includes('duplicate')) {
        console.log(`ℹ️  Migration ${migrationFile} already applied`);
      } else {
        console.error(`❌ Error applying migration ${migrationFile}:`, error);
        throw error;
      }
    }
  }
  
  console.log('✅ Bots table initialized');
}

