import { Context } from 'telegraf';
import { getBotById, updateBotSchema } from '../db/bots';
import { BOT_LIMITS, BotSchema } from '@dialogue-constructor/shared';
import { getBackButtonKeyboard } from './keyboards';

/**
 * Валидация схемы бота
 */
type SchemaValidationError = {
  error: string;
  message?: string;
  currentCount?: number;
};

type SchemaValidationResult =
  | { valid: true }
  | { valid: false; error: SchemaValidationError };

export function validateSchemaLimits(schema: unknown): SchemaValidationResult {
  if (!schema || typeof schema !== 'object') {
    return { valid: false, error: { error: 'Invalid schema format' } };
  }

  const schemaObj = schema as {
    version?: unknown;
    states?: unknown;
    initialState?: unknown;
  };

  if (schemaObj.version !== 1) {
    return { valid: false, error: { error: 'Invalid schema version. Must be 1' } };
  }

  if (!schemaObj.states || typeof schemaObj.states !== 'object' || Array.isArray(schemaObj.states)) {
    return { valid: false, error: { error: 'Invalid states format' } };
  }

  if (!schemaObj.initialState || typeof schemaObj.initialState !== 'string') {
    return { valid: false, error: { error: 'Invalid initialState' } };
  }

  const states = schemaObj.states as Record<string, unknown>;

  if (!states[schemaObj.initialState]) {
    return { valid: false, error: { error: 'Invalid initialState' } };
  }

  const stateKeys = Object.keys(states);
  if (stateKeys.length > BOT_LIMITS.MAX_SCHEMA_STATES) {
    return {
      valid: false,
      error: {
        error: 'Schema too large',
        message: `Maximum ${BOT_LIMITS.MAX_SCHEMA_STATES} states allowed`,
        currentCount: stateKeys.length,
      },
    };
  }

  for (const [stateKey, state] of Object.entries(states)) {
    if (stateKey.length > BOT_LIMITS.MAX_STATE_KEY_LENGTH) {
      return {
        valid: false,
        error: {
          error: 'Invalid state key',
          message: `State key "${stateKey}" exceeds maximum length of ${BOT_LIMITS.MAX_STATE_KEY_LENGTH}`,
        },
      };
    }

    if (!state || typeof state !== 'object') {
      return {
        valid: false,
        error: {
          error: 'Invalid state format',
          message: `State "${stateKey}" must be an object`,
        },
      };
    }

    const stateObj = state as { message?: unknown; buttons?: unknown };

    if (!stateObj.message || typeof stateObj.message !== 'string') {
      return {
        valid: false,
        error: {
          error: 'Invalid state.message type',
          message: `State "${stateKey}" message must be a string`,
        },
      };
    }

    if (stateObj.message.length > BOT_LIMITS.MAX_MESSAGE_LENGTH) {
      return {
        valid: false,
        error: {
          error: 'Message too long',
          message: `Message in state "${stateKey}" exceeds Telegram limit of ${BOT_LIMITS.MAX_MESSAGE_LENGTH} characters`,
        },
      };
    }

    if (stateObj.buttons) {
      if (!Array.isArray(stateObj.buttons)) {
        return {
          valid: false,
          error: {
            error: 'Invalid state.buttons format',
            message: `State "${stateKey}" buttons must be an array`,
          },
        };
      }

      if (stateObj.buttons.length > BOT_LIMITS.MAX_BUTTONS_PER_STATE) {
        return {
          valid: false,
          error: {
            error: 'Too many buttons',
            message: `State "${stateKey}" has ${stateObj.buttons.length} buttons, maximum ${BOT_LIMITS.MAX_BUTTONS_PER_STATE} allowed`,
          },
        };
      }

      for (const button of stateObj.buttons) {
        if (!button || typeof button !== 'object') {
          return {
            valid: false,
            error: {
              error: 'Invalid button format',
              message: `Button in state "${stateKey}" must be an object`,
            },
          };
        }

        const buttonObj = button as { text?: unknown; nextState?: unknown };
        if (!buttonObj.text || typeof buttonObj.text !== 'string') {
          return {
            valid: false,
            error: {
              error: 'Invalid button.text type',
              message: `Button text in state "${stateKey}" must be a string`,
            },
          };
        }

        if (buttonObj.text.length > BOT_LIMITS.MAX_BUTTON_TEXT_LENGTH) {
          return {
            valid: false,
            error: {
              error: 'Button text too long',
              message: `Button text exceeds maximum length of ${BOT_LIMITS.MAX_BUTTON_TEXT_LENGTH}`,
            },
          };
        }

        if (!buttonObj.nextState || typeof buttonObj.nextState !== 'string') {
          return {
            valid: false,
            error: {
              error: 'Invalid button.nextState type',
              message: `Button nextState in state "${stateKey}" must be a string`,
            },
          };
        }

        if (!states[buttonObj.nextState as string]) {
          return {
            valid: false,
            error: {
              error: 'Invalid button.nextState',
              message: `Next state "${buttonObj.nextState as string}" not found`,
            },
          };
        }
      }
    }
  }

  return { valid: true };
}

function validateSchema(schema: unknown): schema is BotSchema {
  return validateSchemaLimits(schema).valid;
}

/**
 * Обработчик команды /editschema <bot_id> <json>
 */
export async function handleEditSchema(ctx: Context, botId?: string, schemaJson?: string) {
  const userId = ctx.from?.id;
  
  if (!userId) {
    await ctx.reply('❌ Не удалось определить ваш ID пользователя.', {
      reply_markup: getBackButtonKeyboard(),
    });
    return;
  }

  if (!botId) {
    await ctx.reply(
      '❌ Не указан ID бота.\n\n' +
      'Использование: <code>/editschema &lt;bot_id&gt; &lt;json&gt;</code>\n\n' +
      'Пример:\n' +
      '<code>/editschema 123456 {"version":1,"states":{"start":{"message":"Привет!","buttons":[{"text":"Далее","nextState":"next"}]},"next":{"message":"Второй шаг"}},"initialState":"start"}</code>',
      {
        parse_mode: 'HTML',
        reply_markup: getBackButtonKeyboard(),
      }
    );
    return;
  }

  if (!schemaJson) {
    await ctx.reply(
      '❌ Не указана схема в формате JSON.\n\n' +
      'Отправьте команду в формате:\n' +
      '<code>/editschema &lt;bot_id&gt; {"version":1,"states":{...},"initialState":"start"}</code>',
      {
        parse_mode: 'HTML',
        reply_markup: getBackButtonKeyboard(),
      }
    );
    return;
  }

  try {
    // Получаем бота из базы данных
    const bot = await getBotById(botId, userId);
    
    if (!bot) {
      await ctx.reply(
        `❌ Бот с ID <code>${botId}</code> не найден или не принадлежит вам.`,
        {
          parse_mode: 'HTML',
          reply_markup: getBackButtonKeyboard(),
        }
      );
      return;
    }

    // Парсим JSON
    let schema: BotSchema;
    try {
      const parsed = JSON.parse(schemaJson);
      schema = parsed;
    } catch (error) {
      await ctx.reply(
        '❌ <b>Ошибка парсинга JSON</b>\n\n' +
        `Ошибка: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}\n\n` +
        'Проверьте правильность JSON-формата.',
        {
          parse_mode: 'HTML',
          reply_markup: getBackButtonKeyboard(),
        }
      );
      return;
    }

    // Валидация схемы
    const validation = validateSchemaLimits(schema);
    if (!validation.valid) {
      const errorPayload = validation.error;
      const errorLines = [
        '❌ <b>Schema validation failed</b>',
        `Error: ${errorPayload.error}`,
      ];
      if (errorPayload.message) {
        errorLines.push(errorPayload.message);
      }
      if (typeof errorPayload.currentCount === 'number') {
        errorLines.push(`Current count: ${errorPayload.currentCount}`);
      }

      await ctx.reply(errorLines.join('\n\n'), {
        parse_mode: 'HTML',
        reply_markup: getBackButtonKeyboard(),
      });
      return;
    }

    // Сохраняем схему
    const success = await updateBotSchema(bot.id, userId, schema);
    
    if (success) {
      await ctx.reply(
        `✅ <b>Схема успешно обновлена!</b>\n\n` +
        `🤖 Бот: <b>${bot.name}</b>\n` +
        `🆔 ID: <code>${bot.id}</code>\n` +
        `📊 Состояний: ${Object.keys(schema.states).length}\n` +
        `🔄 Версия схемы: ${(bot.schema_version || 0) + 1}\n\n` +
        `Начальное состояние: <code>${schema.initialState}</code>`,
        {
          parse_mode: 'HTML',
          reply_markup: getBackButtonKeyboard(),
        }
      );
      console.log(`✅ Schema updated for bot ${bot.id}`);
    } else {
      await ctx.reply(
        '❌ Не удалось обновить схему.',
        {
          reply_markup: getBackButtonKeyboard(),
        }
      );
    }
  } catch (error) {
    console.error('Error in handleEditSchema:', error);
    await ctx.reply(
      '❌ Произошла ошибка при обновлении схемы.',
      {
        reply_markup: getBackButtonKeyboard(),
      }
    );
  }
}

