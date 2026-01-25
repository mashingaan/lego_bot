import pino, { Logger, LoggerOptions } from 'pino';
import { getLoggerConfig } from './logger-config';

const isVercel = process.env.VERCEL === '1';
const logMethods = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;

function serializeRequest(req: any) {
  return {
    method: req?.method,
    url: req?.url,
    headers: req?.headers,
    ip: req?.ip,
  };
}

function serializeResponse(res: any) {
  return {
    statusCode: res?.statusCode,
    headers: res?.getHeaders ? res.getHeaders() : res?.headers,
  };
}

function wrapLogger(baseLogger: Logger): Logger {
  return new Proxy(baseLogger, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function' && logMethods.includes(prop as typeof logMethods[number])) {
        return (first: unknown, second?: unknown, ...rest: unknown[]) => {
          if (
            typeof first === 'string'
            && second
            && typeof second === 'object'
            && !Array.isArray(second)
          ) {
            return (value as (...args: unknown[]) => unknown).call(target, second, first, ...rest);
          }
          return (value as (...args: unknown[]) => unknown).call(target, first, second, ...rest);
        };
      }
      return value;
    },
  }) as Logger;
}

export function createLogger(service: string, options: LoggerOptions = {}): Logger {
  const baseConfig = getLoggerConfig();
  const levelFromEnv = process.env.LOG_LEVEL;
  const resolvedLevel =
    options.level ??
    (isVercel ? levelFromEnv || 'info' : levelFromEnv || baseConfig.level);

  const serializers = {
    err: pino.stdSerializers.err,
    req: serializeRequest,
    res: serializeResponse,
  };

  const loggerOptions: LoggerOptions = {
    ...baseConfig,
    ...options,
    level: resolvedLevel,
    formatters: {
      level: (label: string) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      ...serializers,
      ...options.serializers,
    },
    base: {
      service,
      ...options.base,
    },
  };

  return wrapLogger(pino(loggerOptions));
}

export function createChildLogger(parentLogger: Logger, bindings: Record<string, unknown>): Logger {
  return wrapLogger(parentLogger.child(bindings));
}

export type { Logger, LoggerOptions };
