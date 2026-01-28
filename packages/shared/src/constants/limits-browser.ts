export const RATE_LIMITS = {
  // API endpoints (requests per window)
  API_GENERAL: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per user
  },
  API_CREATE_BOT: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 bot creations
  },
  API_UPDATE_SCHEMA: {
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 20, // 20 schema updates
  },
  // Webhook endpoints
  WEBHOOK_PER_BOT: {
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 webhooks per bot
  },
  WEBHOOK_GLOBAL: {
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

export const WEBHOOK_INTEGRATION_LIMITS = {
  MAX_URL_LENGTH: 2048,
  MAX_HEADERS: 10,
  MAX_HEADER_VALUE_LENGTH: 512,
  MAX_RETRY_COUNT: 3,
  TIMEOUT_MS: 10000,
  AWAIT_FIRST_ATTEMPT_TIMEOUT_MS: 3000,
  MAX_WEBHOOKS_PER_BOT: 20,
  MAX_SIGNING_SECRET_LENGTH: 256,
  MAX_LOG_PAYLOAD_BYTES: 16384,
  MAX_LOG_RESPONSE_BODY_BYTES: 16384,
  MAX_LOG_ERROR_MESSAGE_LENGTH: 1024,
};

export const MEDIA_LIMITS = {
  MAX_MEDIA_URL_LENGTH: 2048,
  MAX_CAPTION_LENGTH: 1024,
  MAX_MEDIA_GROUP_SIZE: 10, // Telegram limit
  ALLOWED_MEDIA_TYPES: ['photo', 'video', 'document', 'audio'] as const,
};
