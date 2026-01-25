const isTestEnv = process.env.NODE_ENV === 'test';

export const RATE_LIMITS = {
  // API endpoints (requests per window)
  API_GENERAL: isTestEnv
    ? { windowMs: 1000, max: 3 }
    : {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100, // 100 requests per user
      },
  API_CREATE_BOT: isTestEnv
    ? { windowMs: 1000, max: 2 }
    : {
        windowMs: 60 * 60 * 1000, // 1 hour
        max: 5, // 5 bot creations
      },
  API_UPDATE_SCHEMA: isTestEnv
    ? { windowMs: 1000, max: 2 }
    : {
        windowMs: 5 * 60 * 1000, // 5 minutes
        max: 20, // 20 schema updates
      },
  // Webhook endpoints
  WEBHOOK_PER_BOT: isTestEnv
    ? { windowMs: 1000, max: 3 }
    : {
        windowMs: 60 * 1000, // 1 minute
        max: 60, // 60 webhooks per bot
      },
  WEBHOOK_GLOBAL: isTestEnv
    ? { windowMs: 1000, max: 5 }
    : {
        windowMs: 60 * 1000, // 1 minute
        max: 500, // 500 webhooks globally
      },
};

export const BOT_LIMITS = {
  MAX_BOTS_PER_USER: 5,
  MAX_SCHEMA_STATES: 50,
  MAX_BUTTONS_PER_STATE: 10,
  MAX_MESSAGE_LENGTH: 4096, // Telegram limit
  MAX_BUTTON_TEXT_LENGTH: 64,
  MAX_STATE_KEY_LENGTH: 100,
};

export const WEBHOOK_LIMITS = {
  MAX_PAYLOAD_SIZE: 1024 * 1024, // 1MB
  SECRET_TOKEN_LENGTH: 32,
};
