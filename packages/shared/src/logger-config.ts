import type { LoggerOptions } from 'pino';

const isVercel = process.env.VERCEL === '1';
const isProduction = process.env.NODE_ENV === 'production';
const logToFile = !isVercel && (process.env.LOG_TO_FILE === 'true' || process.env.LOG_TO_FILE === '1');
const logFilePath = process.env.LOG_FILE_PATH || 'logs/app.log';
const logSizeMb = process.env.LOG_SIZE_MB ?? '100';
const logInterval = process.env.LOG_INTERVAL ?? '1d';
const logMaxFiles = Number(process.env.LOG_MAX_FILES ?? 30);
const logCompress = process.env.LOG_COMPRESS === 'true';

const redactionPaths = ['req.headers.authorization', 'token', 'password', 'DATABASE_URL'];

export function getLoggerConfig(): LoggerOptions {
  const redact = {
    paths: redactionPaths,
    censor: '[REDACTED]',
  };
  const fileTransport = logToFile
    ? {
        transport: {
          target: 'pino-rotating-file-roll',
          options: {
            file: logFilePath,
            size: `${logSizeMb}M`,
            interval: logInterval,
            maxFiles: logMaxFiles,
            mkdir: true,
            compress: logCompress,
          },
        },
      }
    : {};

  if (isVercel) {
    return {
      level: 'info',
      redact,
    };
  }

  if (!isProduction) {
    if (logToFile) {
      return {
        level: 'debug',
        ...fileTransport,
        redact,
      };
    }
    return {
      level: 'debug',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
        },
      },
      redact,
    };
  }

  return {
    level: 'warn',
    ...fileTransport,
    redact,
  };
}
