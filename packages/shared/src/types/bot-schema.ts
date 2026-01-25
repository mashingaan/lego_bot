import { BOT_LIMITS } from '../constants/limits';

/**
 * Интерфейс схемы бота для диалогов
 */
export interface BotSchema {
  version: 1;
  states: {
    [key: string]: {
      message: string;
      buttons?: Array<{
        text: string;
        nextState: string;
      }>;
    };
  };
  initialState: string;
}

export function validateBotSchema(schema: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

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

  for (const [stateKey, state] of Object.entries(states)) {
    if (!state || typeof state !== 'object') {
      errors.push(`State "${stateKey}" must be an object`);
      continue;
    }

    const stateObj = state as { message?: unknown; buttons?: unknown };
    if (!stateObj.message || typeof stateObj.message !== 'string') {
      errors.push(`State "${stateKey}" message must be a string`);
    } else if (stateObj.message.length > BOT_LIMITS.MAX_MESSAGE_LENGTH) {
      errors.push(
        `State "${stateKey}" message exceeds maximum length of ${BOT_LIMITS.MAX_MESSAGE_LENGTH}`
      );
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

      for (const button of stateObj.buttons) {
        if (!button || typeof button !== 'object') {
          errors.push(`Button in state "${stateKey}" must be an object`);
          continue;
        }

        const buttonObj = button as { text?: unknown; nextState?: unknown };
        if (!buttonObj.text || typeof buttonObj.text !== 'string') {
          errors.push(`Button text in state "${stateKey}" must be a string`);
        } else if (buttonObj.text.length > BOT_LIMITS.MAX_BUTTON_TEXT_LENGTH) {
          errors.push(
            `Button text exceeds maximum length of ${BOT_LIMITS.MAX_BUTTON_TEXT_LENGTH}`
          );
        }

        if (!buttonObj.nextState || typeof buttonObj.nextState !== 'string') {
          errors.push(`Button nextState in state "${stateKey}" must be a string`);
        } else if (!states[buttonObj.nextState]) {
          errors.push(`Button nextState "${buttonObj.nextState}" does not exist in states`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Пример валидной схемы:
 * {
 *   "version": 1,
 *   "states": {
 *     "start": {
 *       "message": "Привет! Выберите действие:",
 *       "buttons": [
 *         { "text": "О нас", "nextState": "about" },
 *         { "text": "Контакты", "nextState": "contacts" }
 *       ]
 *     },
 *     "about": {
 *       "message": "Это бот-конструктор диалогов"
 *     },
 *     "contacts": {
 *       "message": "Контакты: @username"
 *     }
 *   },
 *   "initialState": "start"
 * }
 */

