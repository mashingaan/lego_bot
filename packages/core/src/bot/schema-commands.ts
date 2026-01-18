import { Context } from 'telegraf';
import { getBotById, updateBotSchema } from '../db/bots';
import { BotSchema } from '@dialogue-constructor/shared';
import { getBackButtonKeyboard } from './keyboards';

/**
 * Валидация схемы бота
 */
function validateSchema(schema: any): schema is BotSchema {
  if (!schema || typeof schema !== 'object') {
    return false;
  }
  
  if (schema.version !== 1) {
    return false;
  }
  
  if (!schema.states || typeof schema.states !== 'object') {
    return false;
  }
  
  if (!schema.initialState || typeof schema.initialState !== 'string') {
    return false;
  }
  
  // Проверяем, что initialState существует в states
  if (!schema.states[schema.initialState]) {
    return false;
  }
  
  // Проверяем каждое состояние
  for (const [stateKey, state] of Object.entries(schema.states)) {
    if (typeof state !== 'object' || !state) {
      return false;
    }
    
    // Проверяем, что state имеет правильную структуру
    const stateObj = state as { message?: unknown; buttons?: unknown };
    
    if (!stateObj.message || typeof stateObj.message !== 'string') {
      return false;
    }
    
    // Проверяем кнопки, если они есть
    if (stateObj.buttons) {
      if (!Array.isArray(stateObj.buttons)) {
        return false;
      }
      
      for (const button of stateObj.buttons) {
        const buttonObj = button as { text?: unknown; nextState?: unknown };
        if (!buttonObj.text || typeof buttonObj.text !== 'string') {
          return false;
        }
        if (!buttonObj.nextState || typeof buttonObj.nextState !== 'string') {
          return false;
        }
        // Проверяем, что nextState существует в states
        if (!schema.states[buttonObj.nextState as string]) {
          return false;
        }
      }
    }
  }
  
  return true;
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
    if (!validateSchema(schema)) {
      await ctx.reply(
        '❌ <b>Схема невалидна</b>\n\n' +
        'Схема должна содержать:\n' +
        '• <code>version: 1</code>\n' +
        '• <code>states</code> - объект с состояниями\n' +
        '• <code>initialState</code> - начальное состояние\n\n' +
        'Каждое состояние должно иметь:\n' +
        '• <code>message</code> - текст сообщения\n' +
        '• <code>buttons</code> (опционально) - массив кнопок\n\n' +
        'Кнопки должны ссылаться на существующие состояния.',
        {
          parse_mode: 'HTML',
          reply_markup: getBackButtonKeyboard(),
        }
      );
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

