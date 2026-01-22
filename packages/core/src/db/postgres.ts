import { Pool, PoolClient } from 'pg';

let pool: Pool | null = null;

const POSTGRES_RETRY_CONFIG = {
  maxRetries: 5,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
};

type PostgresConnectionInfo = {
  host: string;
  port: string;
  database: string;
  user: string;
};

function getPostgresConnectionInfo(connectionString: string): PostgresConnectionInfo | null {
  try {
    const url = new URL(connectionString);
    return {
      host: url.hostname,
      port: url.port || 'default',
      database: url.pathname ? url.pathname.substring(1) : 'not specified',
      user: url.username || 'not specified',
    };
  } catch {
    return null;
  }
}

function formatPostgresConnectionInfo(connectionInfo: PostgresConnectionInfo | null): string {
  if (!connectionInfo) {
    return 'unknown';
  }
  return `${connectionInfo.host}:${connectionInfo.port}/${connectionInfo.database}`;
}

function logConnectionError(service: string, error: unknown, context: Record<string, unknown>) {
  const err = error as { code?: string; message?: string; stack?: string };
  console.error(`${service} connection error`, {
    timestamp: new Date().toISOString(),
    service,
    code: err?.code,
    message: err?.message || String(error),
    stack: err?.stack,
    ...context,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectWithRetry(
  activePool: Pool,
  connectionInfo: PostgresConnectionInfo | null
): Promise<void> {
  const startTime = Date.now();
  let delayMs = POSTGRES_RETRY_CONFIG.initialDelayMs;

  console.log('PostgreSQL connection state: connecting', {
    connection: connectionInfo,
    maxRetries: POSTGRES_RETRY_CONFIG.maxRetries,
  });

  for (let attempt = 1; attempt <= POSTGRES_RETRY_CONFIG.maxRetries; attempt++) {
    const attemptStart = Date.now();
    try {
      const result = await activePool.query('SELECT NOW()');
      const durationMs = Date.now() - attemptStart;
      const totalDurationMs = Date.now() - startTime;
      console.log('PostgreSQL connection state: connected', {
        attempt,
        durationMs,
        totalDurationMs,
        databaseTime: result.rows?.[0]?.now,
        connection: connectionInfo,
      });
      return;
    } catch (error) {
      const durationMs = Date.now() - attemptStart;
      const nextDelayMs = Math.min(delayMs, POSTGRES_RETRY_CONFIG.maxDelayMs);
      logConnectionError('postgres', error, {
        attempt,
        durationMs,
        nextDelayMs: attempt < POSTGRES_RETRY_CONFIG.maxRetries ? nextDelayMs : 0,
        connection: connectionInfo,
      });
      if (attempt === POSTGRES_RETRY_CONFIG.maxRetries) {
        const totalDurationMs = Date.now() - startTime;
        console.error('PostgreSQL connection state: error', {
          attempts: attempt,
          totalDurationMs,
          connection: connectionInfo,
        });
        throw new Error(
          `PostgreSQL connection failed after ${attempt} attempts (${formatPostgresConnectionInfo(connectionInfo)})`
        );
      }
      console.warn('PostgreSQL connection retry scheduled', {
        attempt,
        delayMs: nextDelayMs,
        connection: connectionInfo,
      });
      await sleep(nextDelayMs);
      delayMs = Math.min(delayMs * 2, POSTGRES_RETRY_CONFIG.maxDelayMs);
    }
  }
}

export async function initPostgres(): Promise<Pool> {
  if (pool) {
    return pool;
  }

  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set in environment variables');
  }

  const connectionInfo = getPostgresConnectionInfo(connectionString);

  // Логируем части URL для диагностики (без паролей)
  if (connectionInfo) {
    console.log('📍 PostgreSQL connection info:');
    console.log('  Host:', connectionInfo.host);
    console.log('  Port:', connectionInfo.port);
    console.log('  Database:', connectionInfo.database);
    console.log('  User:', connectionInfo.user);
    console.log('  Password:', 'not logged');
  } else {
    console.log('⚠️ Could not parse DATABASE_URL (might be invalid format)');
  }

  const candidatePool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000, // Увеличиваем timeout для диагностики
  });

  candidatePool.on('error', (err) => {
    logConnectionError('postgres', err, {
      event: 'idle_client_error',
      connection: connectionInfo,
    });
  });

  try {
    await connectWithRetry(candidatePool, connectionInfo);
  } catch (error) {
    try {
      await candidatePool.end();
    } catch (endError) {
      logConnectionError('postgres', endError, {
        event: 'pool_end_error',
        connection: connectionInfo,
      });
    }
    throw error;
  }

  pool = candidatePool;
  return pool;
}

export async function getPostgresClient(): Promise<PoolClient> {
  console.log('🔊 getPostgresClient - pool exists:', !!pool);
  const connectionString = process.env.DATABASE_URL;
  const connectionInfo = connectionString ? getPostgresConnectionInfo(connectionString) : null;
  
  if (!pool) {
    console.log('📦 Initializing PostgreSQL pool...');
    await initPostgres();
  }
  
  if (!pool) {
    console.error('❌ PostgreSQL pool is not initialized');
    throw new Error('PostgreSQL pool is not initialized');
  }

  if ((pool as any).ended) {
    throw new Error(
      `PostgreSQL pool has been closed (${formatPostgresConnectionInfo(connectionInfo)})`
    );
  }

  try {
    console.log('🔗 Connecting to PostgreSQL...');
    const client = await pool.connect();
    console.log('✅ PostgreSQL client connected');
    return client;
  } catch (error) {
    logConnectionError('postgres', error, {
      action: 'connect',
      connection: connectionInfo,
    });
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `PostgreSQL connection failed (${formatPostgresConnectionInfo(connectionInfo)}): ${message}`
    );
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
