import {
  RATE_LIMITS as DEFAULT_RATE_LIMITS,
  BOT_LIMITS as BASE_BOT_LIMITS,
  WEBHOOK_LIMITS as BASE_WEBHOOK_LIMITS,
  WEBHOOK_INTEGRATION_LIMITS as BASE_WEBHOOK_INTEGRATION_LIMITS,
  MEDIA_LIMITS as BASE_MEDIA_LIMITS,
} from './limits-browser';

const isTestEnv = process.env.NODE_ENV === 'test';

const TEST_RATE_LIMITS = {
  // API endpoints (requests per window)
  API_GENERAL: { windowMs: 1000, max: 3 },
  API_CREATE_BOT: { windowMs: 1000, max: 2 },
  API_UPDATE_SCHEMA: { windowMs: 1000, max: 2 },
  // Webhook endpoints
  WEBHOOK_PER_BOT: { windowMs: 1000, max: 3 },
  WEBHOOK_GLOBAL: { windowMs: 1000, max: 5 },
};

export const RATE_LIMITS = isTestEnv ? TEST_RATE_LIMITS : DEFAULT_RATE_LIMITS;
export const BOT_LIMITS = BASE_BOT_LIMITS;
export const WEBHOOK_LIMITS = BASE_WEBHOOK_LIMITS;
export const WEBHOOK_INTEGRATION_LIMITS = BASE_WEBHOOK_INTEGRATION_LIMITS;
export const MEDIA_LIMITS = BASE_MEDIA_LIMITS;
