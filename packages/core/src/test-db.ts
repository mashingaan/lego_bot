/**
 * Тестовый скрипт для проверки подключения к PostgreSQL и Redis
 * Запуск: npx tsx src/test-db.ts
 */

import dotenv from 'dotenv';
import { initPostgres, getPostgresClient, closePostgres } from './db/postgres';
import { initRedis, getRedisClient, closeRedis } from './db/redis';

dotenv.config();

async function testConnections() {
  console.log('🔍 Testing database connections...\n');

  // Test PostgreSQL
  console.log('📊 Testing PostgreSQL connection...');
  try {
    const pool = await initPostgres();
    
    // Wait a bit for connection to establish
    await new Promise((resolve) => setTimeout(resolve, 1000));
    
    const client = await getPostgresClient();
    const result = await client.query('SELECT version(), NOW() as current_time');
    console.log('✅ PostgreSQL connection successful!');
    console.log('   Version:', result.rows[0].version.split(',')[0]);
    console.log('   Server time:', result.rows[0].current_time);
    
    // Test creating a table (optional)
    await client.query(`
      CREATE TABLE IF NOT EXISTS test_connection (
        id SERIAL PRIMARY KEY,
        message TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('   Test table created/verified');
    
    // Insert test data
    await client.query(
      'INSERT INTO test_connection (message) VALUES ($1)',
      ['Test connection from Node.js']
    );
    console.log('   Test data inserted');
    
    // Read test data
    const testResult = await client.query('SELECT * FROM test_connection ORDER BY id DESC LIMIT 1');
    console.log('   Test data retrieved:', testResult.rows[0]);
    
    client.release();
    
    await closePostgres();
    console.log('✅ PostgreSQL test completed\n');
  } catch (error) {
    console.error('❌ PostgreSQL connection failed:', error);
    console.error('   Make sure PostgreSQL is running and DATABASE_URL is correct\n');
  }

  // Test Redis
  console.log('📦 Testing Redis connection...');
  try {
    const redis = await initRedis();
    if (!redis) {
      throw new Error('Redis client is not initialized');
    }
    
    // Wait a bit for connection to establish
    await new Promise((resolve) => setTimeout(resolve, 1000));
    
    await redis.ping();
    console.log('✅ Redis connection successful!');
    
    // Test set/get
    await redis.set('test:connection', 'Hello from Node.js!');
    const value = await redis.get('test:connection');
    console.log('   Test key set/get:', value);
    
    // Get Redis info
    const info = await redis.info('server');
    const versionMatch = info.match(/redis_version:([^\r\n]+)/);
    if (versionMatch) {
      console.log('   Redis version:', versionMatch[1]);
    }
    
    await closeRedis();
    console.log('✅ Redis test completed\n');
  } catch (error) {
    console.error('❌ Redis connection failed:', error);
    console.error('   Make sure Redis is running and REDIS_URL is correct\n');
  }

  console.log('✨ Connection tests completed!');
  process.exit(0);
}

testConnections().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

