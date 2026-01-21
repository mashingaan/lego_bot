import { Pool, PoolClient } from 'pg';

let pool: Pool | null = null;

export function initPostgres(): Pool {
  if (pool) {
    return pool;
  }

  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set in environment variables');
  }

  // Логируем части URL для диагностики (без паролей)
  try {
    const url = new URL(connectionString);
    console.log('🔌 PostgreSQL connection info:');
    console.log('  Protocol:', url.protocol);
    console.log('  Host:', url.hostname);
    console.log('  Port:', url.port || 'default');
    console.log('  Database:', url.pathname ? url.pathname.substring(1) : 'not specified');
    console.log('  User:', url.username || 'not specified');
    console.log('  Password:', url.password ? '***SET***' : 'not set');
  } catch (e) {
    console.log('⚠️ Could not parse DATABASE_URL (might be invalid format)');
  }

  pool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000, // Увеличиваем timeout для диагностики
  });

  pool.on('error', (err) => {
    console.error('❌ Unexpected error on idle PostgreSQL client:', err);
    console.error('Error code:', (err as any).code);
    console.error('Error message:', err.message);
  });

  // Test connection (async, но не блокируем инициализацию)
  pool.query('SELECT NOW()', (err, res) => {
    if (err) {
      console.error('❌ PostgreSQL connection test error:', err);
      console.error('Error code:', (err as any).code);
      console.error('Error message:', err.message);
      console.error('Error severity:', (err as any).severity);
    } else {
      console.log('✅ PostgreSQL connected successfully');
      console.log('Database time:', res.rows[0].now);
    }
  });

  return pool;
}

export async function getPostgresClient(): Promise<PoolClient> {
  console.log('🔌 getPostgresClient - pool exists:', !!pool);
  
  if (!pool) {
    console.log('📦 Initializing PostgreSQL pool...');
    initPostgres();
  }
  
  if (!pool) {
    console.error('❌ PostgreSQL pool is not initialized');
    throw new Error('PostgreSQL pool is not initialized');
  }

  try {
    console.log('🔗 Connecting to PostgreSQL...');
    const client = await pool.connect();
    console.log('✅ PostgreSQL client connected');
    return client;
  } catch (error) {
    console.error('❌ Error connecting to PostgreSQL:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack');
    throw error;
  }
}

export function closePostgres(): Promise<void> {
  if (pool) {
    return pool.end();
  }
  return Promise.resolve();
}

export function getPool(): Pool | null {
  return pool;
}

