import { BOT_LIMITS, MEDIA_LIMITS, WEBHOOK_INTEGRATION_LIMITS } from '../constants/limits';
import { isIP } from '../utils/ip-validation';
import type {
  WebhookConfig,
  IntegrationTemplate,
  MediaContent,
  MediaGroupItem,
  BotSchema,
  NavigationButton,
  RequestContactButton,
  RequestEmailButton,
  UrlButton,
  BotButton,
} from '../types/bot-schema-browser';

const parseAllowlist = (value?: string) => {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
};

const isIpPrivate = (ip: string) => {
  if (ip.includes(':')) {
    const normalized = ip.toLowerCase();
    return (
      normalized === '::1' ||
      normalized.startsWith('fe80:') ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd')
    );
  }

  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }

  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  return false;
};

const isDisallowedHost = (hostname: string) => {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost')) {
    return true;
  }
  if (isIP(lower)) {
    return isIpPrivate(lower);
  }
  return false;
};

const isAllowedByAllowlist = (hostname: string, allowlist: string[]) => {
  if (allowlist.length === 0) {
    return true;
  }
  const lower = hostname.toLowerCase();
  return allowlist.some((domain) => lower === domain || lower.endsWith(`.${domain}`));
};

const isValidHttpsUrl = (value: string, maxLength: number) => {
  if (!value || value.length > maxLength) {
    return false;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') {
      return false;
    }
    if (isDisallowedHost(parsed.hostname)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
};

export function validateBotSchema(schema: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const allowlist = parseAllowlist(process.env.WEBHOOK_DOMAIN_ALLOWLIST);

  if (!schema || typeof schema !== 'object') {
    return { valid: false, errors: ['Schema must be an object'] };
  }

  const schemaObj = schema as {
    version?: unknown;
    states?: unknown;
    initialState?: unknown;
  };

  if (schemaObj.version !== 1) {
    errors.push('Schema version must be 1');
  }

  if (!schemaObj.states || typeof schemaObj.states !== 'object' || Array.isArray(schemaObj.states)) {
    errors.push('Schema states must be an object');
  }

  if (!schemaObj.initialState || typeof schemaObj.initialState !== 'string') {
    errors.push('Schema initialState must be a string');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const states = schemaObj.states as Record<string, unknown>;
  const initialState = schemaObj.initialState as string;

  if (!states[initialState]) {
    errors.push('Initial state does not exist in states');
  }

  const stateKeys = Object.keys(states);
  if (stateKeys.length > BOT_LIMITS.MAX_SCHEMA_STATES) {
    errors.push(`Schema exceeds maximum states of ${BOT_LIMITS.MAX_SCHEMA_STATES}`);
  }

  let enabledWebhookCount = 0;

  for (const [stateKey, state] of Object.entries(states)) {
    if (!state || typeof state !== 'object') {
      errors.push(`State "${stateKey}" must be an object`);
      continue;
    }

    const stateObj = state as {
      message?: unknown;
      buttons?: unknown;
      webhook?: unknown;
      integration?: unknown;
      media?: unknown;
      mediaGroup?: unknown;
      parseMode?: unknown;
    };
    if (!stateObj.message || typeof stateObj.message !== 'string') {
      errors.push(`State "${stateKey}" message must be a string`);
    } else if (stateObj.message.length > BOT_LIMITS.MAX_MESSAGE_LENGTH) {
      errors.push(
        `State "${stateKey}" message exceeds maximum length of ${BOT_LIMITS.MAX_MESSAGE_LENGTH}`
      );
    }

    if (stateObj.parseMode !== undefined) {
      if (
        stateObj.parseMode !== 'HTML' &&
        stateObj.parseMode !== 'Markdown' &&
        stateObj.parseMode !== 'MarkdownV2'
      ) {
        errors.push(`State "${stateKey}" parseMode is invalid`);
      }
    }

    if (stateObj.media !== undefined && stateObj.mediaGroup !== undefined) {
      errors.push(`State "${stateKey}" cannot have both media and mediaGroup`);
    }

    if (stateObj.media !== undefined) {
      if (!stateObj.media || typeof stateObj.media !== 'object' || Array.isArray(stateObj.media)) {
        errors.push(`State "${stateKey}" media must be an object`);
      } else {
        const media = stateObj.media as {
          type?: unknown;
          url?: unknown;
          caption?: unknown;
          cover?: unknown;
          thumbnail?: unknown;
        };
        if (!media.type || typeof media.type !== 'string' || !MEDIA_LIMITS.ALLOWED_MEDIA_TYPES.includes(media.type as any)) {
          errors.push(`State "${stateKey}" media.type is invalid`);
        }
        if (!media.url || typeof media.url !== 'string') {
          errors.push(`State "${stateKey}" media.url must be a string`);
        } else if (!isValidHttpsUrl(media.url, MEDIA_LIMITS.MAX_MEDIA_URL_LENGTH)) {
          errors.push(`State "${stateKey}" media.url must be a valid HTTPS URL`);
        }
        if (media.caption !== undefined) {
          if (typeof media.caption !== 'string') {
            errors.push(`State "${stateKey}" media.caption must be a string`);
          } else if (media.caption.length > MEDIA_LIMITS.MAX_CAPTION_LENGTH) {
            errors.push(
              `State "${stateKey}" media.caption exceeds maximum length of ${MEDIA_LIMITS.MAX_CAPTION_LENGTH}`
            );
          }
        }
        if (media.cover !== undefined) {
          if (typeof media.cover !== 'string') {
            errors.push(`State "${stateKey}" media.cover must be a string`);
          } else if (media.cover.startsWith('https://')) {
            if (!isValidHttpsUrl(media.cover, MEDIA_LIMITS.MAX_MEDIA_URL_LENGTH)) {
              errors.push(`State "${stateKey}" media.cover must be a valid HTTPS URL`);
            }
          } else if (media.cover.startsWith('http://') || media.cover.startsWith('attach://')) {
            errors.push(`State "${stateKey}" media.cover must be a valid HTTPS URL or file_id`);
          }
        }
        if (media.thumbnail !== undefined) {
          if (typeof media.thumbnail !== 'string') {
            errors.push(`State "${stateKey}" media.thumbnail must be a string`);
          } else if (!media.thumbnail.startsWith('attach://')) {
            errors.push(
              `State "${stateKey}" media.thumbnail requires multipart/form-data (attach://...) in v1; use cover (URL) instead`
            );
          }
        }
      }
    }

    if (stateObj.mediaGroup !== undefined) {
      if (!Array.isArray(stateObj.mediaGroup)) {
        errors.push(`State "${stateKey}" mediaGroup must be an array`);
      } else {
        if (stateObj.mediaGroup.length < 2 || stateObj.mediaGroup.length > MEDIA_LIMITS.MAX_MEDIA_GROUP_SIZE) {
          errors.push(
            `State "${stateKey}" mediaGroup size must be between 2 and ${MEDIA_LIMITS.MAX_MEDIA_GROUP_SIZE}`
          );
        }
        for (const item of stateObj.mediaGroup) {
          if (!item || typeof item !== 'object' || Array.isArray(item)) {
            errors.push(`State "${stateKey}" mediaGroup item must be an object`);
            continue;
          }
          const mediaItem = item as { type?: unknown; url?: unknown; caption?: unknown };
          if (mediaItem.type !== 'photo' && mediaItem.type !== 'video') {
            errors.push(`State "${stateKey}" mediaGroup item type must be 'photo' or 'video'`);
          }
          if (!mediaItem.url || typeof mediaItem.url !== 'string') {
            errors.push(`State "${stateKey}" mediaGroup item url must be a string`);
          } else if (!isValidHttpsUrl(mediaItem.url, MEDIA_LIMITS.MAX_MEDIA_URL_LENGTH)) {
            errors.push(`State "${stateKey}" mediaGroup item url must be a valid HTTPS URL`);
          }
          if (mediaItem.caption !== undefined) {
            if (typeof mediaItem.caption !== 'string') {
              errors.push(`State "${stateKey}" mediaGroup item caption must be a string`);
            } else if (mediaItem.caption.length > MEDIA_LIMITS.MAX_CAPTION_LENGTH) {
              errors.push(
                `State "${stateKey}" mediaGroup item caption exceeds maximum length of ${MEDIA_LIMITS.MAX_CAPTION_LENGTH}`
              );
            }
          }
        }
      }
    }

    if (stateObj.buttons !== undefined) {
      if (!Array.isArray(stateObj.buttons)) {
        errors.push(`State "${stateKey}" buttons must be an array`);
        continue;
      }

      if (stateObj.buttons.length > BOT_LIMITS.MAX_BUTTONS_PER_STATE) {
        errors.push(
          `State "${stateKey}" exceeds maximum buttons of ${BOT_LIMITS.MAX_BUTTONS_PER_STATE}`
        );
      }

      let requestContactCount = 0;
      let requestEmailCount = 0;
      let inlineCount = 0;

      for (const button of stateObj.buttons) {
        if (!button || typeof button !== 'object') {
          errors.push(`Button in state "${stateKey}" must be an object`);
          continue;
        }

        const buttonObj = button as { text?: unknown; nextState?: unknown; type?: unknown; url?: unknown };
        const buttonType = buttonObj.type ?? 'navigation';
        if (buttonType !== 'navigation' && buttonType !== 'request_contact' && buttonType !== 'request_email' && buttonType !== 'url') {
          errors.push(`Button type in state "${stateKey}" must be 'navigation', 'request_contact', 'request_email', or 'url'`);
        }

        if (buttonType === 'request_contact') {
          requestContactCount += 1;
        } else if (buttonType === 'request_email') {
          requestEmailCount += 1;
        } else {
          inlineCount += 1;
        }

        if (!buttonObj.text || typeof buttonObj.text !== 'string') {
          errors.push(`Button text in state "${stateKey}" must be a string`);
        } else if (buttonObj.text.length > BOT_LIMITS.MAX_BUTTON_TEXT_LENGTH) {
          errors.push(
            `Button text exceeds maximum length of ${BOT_LIMITS.MAX_BUTTON_TEXT_LENGTH}`
          );
        }

        if (buttonType === 'url') {
          if (!buttonObj.url || typeof buttonObj.url !== 'string') {
            errors.push(`Button url in state "${stateKey}" must be a string`);
          } else if (!isValidHttpsUrl(buttonObj.url, MEDIA_LIMITS.MAX_MEDIA_URL_LENGTH)) {
            errors.push(`Button url in state "${stateKey}" must be a valid HTTPS URL`);
          }
        } else {
          if (!buttonObj.nextState || typeof buttonObj.nextState !== 'string') {
            errors.push(`Button nextState in state "${stateKey}" must be a string`);
          } else if (!states[buttonObj.nextState]) {
            errors.push(`Button nextState "${buttonObj.nextState}" does not exist in states`);
          }
        }
      }

      if (requestContactCount + requestEmailCount > 1) {
        errors.push(`State "${stateKey}" can only have one request button`);
      }

      if (requestContactCount + requestEmailCount > 0 && inlineCount > 0) {
        errors.push(`State "${stateKey}" cannot mix request and navigation buttons`);
      }
    }

    if (stateObj.webhook !== undefined) {
      if (!stateObj.webhook || typeof stateObj.webhook !== 'object' || Array.isArray(stateObj.webhook)) {
        errors.push(`State "${stateKey}" webhook must be an object`);
      } else {
        const webhook = stateObj.webhook as {
          url?: unknown;
          method?: unknown;
          headers?: unknown;
          signingSecret?: unknown;
          enabled?: unknown;
          retryCount?: unknown;
          timeout?: unknown;
        };

        if (typeof webhook.enabled !== 'boolean') {
          errors.push(`State "${stateKey}" webhook.enabled must be a boolean`);
        } else if (webhook.enabled) {
          enabledWebhookCount += 1;
        }

        if (webhook.url !== undefined) {
          if (typeof webhook.url !== 'string' || webhook.url.length === 0) {
            errors.push(`State "${stateKey}" webhook.url must be a non-empty string`);
          } else {
            if (webhook.url.length > WEBHOOK_INTEGRATION_LIMITS.MAX_URL_LENGTH) {
              errors.push(`State "${stateKey}" webhook.url exceeds max length`);
            }
            try {
              const parsedUrl = new URL(webhook.url);
              if (parsedUrl.protocol !== 'https:') {
                errors.push(`State "${stateKey}" webhook.url must use https`);
              }
              if (isDisallowedHost(parsedUrl.hostname)) {
                errors.push(`State "${stateKey}" webhook.url points to a disallowed host`);
              }
              if (!isAllowedByAllowlist(parsedUrl.hostname, allowlist)) {
                errors.push(`State "${stateKey}" webhook.url is not in allowlist`);
              }
            } catch {
              errors.push(`State "${stateKey}" webhook.url must be a valid URL`);
            }
          }
        } else if (webhook.enabled) {
          errors.push(`State "${stateKey}" webhook.url is required when enabled`);
        }

        if (webhook.method !== undefined && webhook.method !== 'POST' && webhook.method !== 'GET') {
          errors.push(`State "${stateKey}" webhook.method must be 'POST' or 'GET'`);
        }

        if (webhook.headers !== undefined) {
          if (!webhook.headers || typeof webhook.headers !== 'object' || Array.isArray(webhook.headers)) {
            errors.push(`State "${stateKey}" webhook.headers must be an object`);
          } else {
            const entries = Object.entries(webhook.headers as Record<string, unknown>);
            if (entries.length > WEBHOOK_INTEGRATION_LIMITS.MAX_HEADERS) {
              errors.push(`State "${stateKey}" webhook.headers exceeds max count`);
            }
            for (const [headerKey, headerValue] of entries) {
              if (!headerKey || typeof headerKey !== 'string') {
                errors.push(`State "${stateKey}" webhook.headers contains invalid header name`);
                continue;
              }
              if (typeof headerValue !== 'string') {
                errors.push(`State "${stateKey}" webhook.headers must have string values`);
                continue;
              }
              if (headerValue.length > WEBHOOK_INTEGRATION_LIMITS.MAX_HEADER_VALUE_LENGTH) {
                errors.push(`State "${stateKey}" webhook.headers value too long`);
              }
            }
          }
        }

        if (webhook.signingSecret !== undefined) {
          if (typeof webhook.signingSecret !== 'string') {
            errors.push(`State "${stateKey}" webhook.signingSecret must be a string`);
          } else if (
            webhook.signingSecret.length > WEBHOOK_INTEGRATION_LIMITS.MAX_SIGNING_SECRET_LENGTH
          ) {
            errors.push(`State "${stateKey}" webhook.signingSecret too long`);
          }
        }

        if (webhook.retryCount !== undefined) {
          if (
            typeof webhook.retryCount !== 'number' ||
            !Number.isInteger(webhook.retryCount) ||
            webhook.retryCount < 0 ||
            webhook.retryCount > WEBHOOK_INTEGRATION_LIMITS.MAX_RETRY_COUNT
          ) {
            errors.push(`State "${stateKey}" webhook.retryCount must be a non-negative integer`);
          }
        }

        if (webhook.timeout !== undefined) {
          if (
            typeof webhook.timeout !== 'number' ||
            webhook.timeout <= 0 ||
            webhook.timeout > WEBHOOK_INTEGRATION_LIMITS.TIMEOUT_MS
          ) {
            errors.push(`State "${stateKey}" webhook.timeout must be a positive number`);
          }
        }
      }
    }

    if (stateObj.integration !== undefined) {
      if (!stateObj.integration || typeof stateObj.integration !== 'object' || Array.isArray(stateObj.integration)) {
        errors.push(`State "${stateKey}" integration must be an object`);
      } else {
        const integration = stateObj.integration as { type?: unknown; config?: unknown };
        if (
          integration.type !== 'google_sheets' &&
          integration.type !== 'telegram_channel' &&
          integration.type !== 'custom'
        ) {
          errors.push(`State "${stateKey}" integration.type is invalid`);
        }
        if (!integration.config || typeof integration.config !== 'object' || Array.isArray(integration.config)) {
          errors.push(`State "${stateKey}" integration.config must be an object`);
        }
      }
    }
  }

  if (enabledWebhookCount > WEBHOOK_INTEGRATION_LIMITS.MAX_WEBHOOKS_PER_BOT) {
    errors.push(
      `Schema exceeds maximum webhooks of ${WEBHOOK_INTEGRATION_LIMITS.MAX_WEBHOOKS_PER_BOT}`
    );
  }

  return { valid: errors.length === 0, errors };
}
