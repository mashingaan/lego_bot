import type { Logger } from '../logger';

export type RetryConfig = {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
  jitterMs: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRecoverableError(error: Error): boolean {
  const code = (error as { code?: string }).code;
  const message = error.message || '';
  const recoverableCodes = new Set([
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ECONNRESET',
    'EAI_AGAIN',
    'ENOTFOUND',
    'ECONNABORTED',
    'EPIPE',
  ]);

  if (code && recoverableCodes.has(code)) {
    return true;
  }

  return /timeout|temporarily|temporary|network|connection/i.test(message);
}

export async function withFallback<T>(
  primary: () => Promise<T>,
  fallback: () => Promise<T>,
  logger: Logger
): Promise<T> {
  try {
    return await primary();
  } catch (error) {
    logger.warn({ error }, 'Primary failed, using fallback');
  }

  try {
    return await fallback();
  } catch (error) {
    logger.error({ error }, 'Fallback failed');
    throw error;
  }
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  logger: Logger
): Promise<T> {
  let delayMs = config.initialDelayMs;
  let lastError: unknown;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!(error instanceof Error) || !isRecoverableError(error)) {
        throw error;
      }

      if (attempt === config.maxRetries) {
        break;
      }

      const jitter = Math.random() * config.jitterMs;
      const nextDelayMs = Math.min(delayMs, config.maxDelayMs);
      const actualDelayMs = nextDelayMs + jitter;

      logger.warn(
        { attempt, nextDelayMs, jitterMs: jitter, actualDelayMs, error },
        'Retry scheduled'
      );

      await sleep(actualDelayMs);
      delayMs = Math.min(delayMs * config.backoffFactor, config.maxDelayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Retry failed');
}
