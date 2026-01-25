import crypto from 'crypto';
import { WEBHOOK_LIMITS } from '@dialogue-constructor/shared';
import { Context } from 'telegraf';
import { getBotById, setBotWebhookSecret, updateWebhookStatus } from '../db/bots';
import { decryptToken } from '../utils/encryption';
import { setWebhook, deleteWebhook } from '../services/telegram-webhook';
import { getBackButtonKeyboard } from './keyboards';

/**
 * Обработчик команды /setwebhook <bot_id>
 */
export async function handleSetWebhook(ctx: Context, botId?: string) {
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
      'Использование: <code>/setwebhook &lt;bot_id&gt;</code>\n\n' +
      'Чтобы узнать ID бота, используйте команду /my_bots',
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
        '❌ Бот не найден или webhook secret не настроен',
        {
          parse_mode: 'HTML',
          reply_markup: getBackButtonKeyboard(),
        }
      );
      return;
    }

    // Расшифровываем токен
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      console.error('ENCRYPTION_KEY is not set');
      await ctx.reply(
        '❌ Ошибка конфигурации: ENCRYPTION_KEY не установлен.',
        {
          reply_markup: getBackButtonKeyboard(),
        }
      );
      return;
    }

    let decryptedToken: string;
    try {
      decryptedToken = decryptToken(bot.token, encryptionKey);
    } catch (error) {
      console.error('Failed to decrypt token:', error);
      await ctx.reply(
        '❌ Не удалось расшифровать токен бота. Возможно, используется неправильный ключ шифрования.',
        {
          reply_markup: getBackButtonKeyboard(),
        }
      );
      return;
    }

    // Получаем URL роутера для webhook
    let secretToken = bot.webhook_secret;
    if (!secretToken) {
      const generatedSecret = crypto.randomBytes(WEBHOOK_LIMITS.SECRET_TOKEN_LENGTH).toString('hex');
      const updated = await setBotWebhookSecret(bot.id, userId, generatedSecret);
      if (!updated) {
        throw new Error('Failed to set webhook secret');
      }
      secretToken = generatedSecret;
    }

    const routerUrl = process.env.ROUTER_URL || process.env.WEBHOOK_URL || 'http://localhost:3001';
    const webhookUrl = `${routerUrl}/webhook/${bot.id}`;

    console.log(`🔗 Настройка webhook для бота ${bot.id} (${bot.name})`);
    console.log(`   URL: ${webhookUrl}`);

    // Устанавливаем webhook через Telegram API
    try {
      const result = await setWebhook(decryptedToken, webhookUrl, secretToken, ['message', 'callback_query']);
      
      if (result.ok) {
        // Обновляем статус в базе данных
        await updateWebhookStatus(bot.id, userId, true);
        
        await ctx.reply(
          `✅ <b>Webhook успешно настроен!</b>\n\n` +
          `🤖 Бот: <b>${bot.name}</b>\n` +
          `🆔 ID: <code>${bot.id}</code>\n` +
          `🔗 URL: <code>${webhookUrl}</code>\n\n` +
          `Теперь бот будет получать обновления через роутер.`,
          {
            parse_mode: 'HTML',
            reply_markup: getBackButtonKeyboard(),
          }
        );
        console.log(`✅ Webhook установлен для бота ${bot.id}`);
      } else {
        throw new Error(result.description || 'Unknown error');
      }
    } catch (error) {
      console.error(`❌ Ошибка при настройке webhook для бота ${bot.id}:`, error);
      
      const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
      
      await ctx.reply(
        `❌ <b>Не удалось настроить webhook</b>\n\n` +
        `Ошибка: ${errorMessage}\n\n` +
        `Возможные причины:\n` +
        `• Неверный токен бота\n` +
        `• Проблемы с сетью\n` +
        `• Неверный URL роутера`,
        {
          parse_mode: 'HTML',
          reply_markup: getBackButtonKeyboard(),
        }
      );
    }
  } catch (error) {
    console.error('Error in handleSetWebhook:', error);
    await ctx.reply(
      '❌ Произошла ошибка при настройке webhook.',
      {
        reply_markup: getBackButtonKeyboard(),
      }
    );
  }
}

/**
 * Обработчик команды /deletewebhook <bot_id>
 */
export async function handleDeleteWebhook(ctx: Context, botId?: string) {
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
      'Использование: <code>/deletewebhook &lt;bot_id&gt;</code>\n\n' +
      'Чтобы узнать ID бота, используйте команду /my_bots',
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

    // Расшифровываем токен
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      console.error('ENCRYPTION_KEY is not set');
      await ctx.reply(
        '❌ Ошибка конфигурации: ENCRYPTION_KEY не установлен.',
        {
          reply_markup: getBackButtonKeyboard(),
        }
      );
      return;
    }

    let decryptedToken: string;
    try {
      decryptedToken = decryptToken(bot.token, encryptionKey);
    } catch (error) {
      console.error('Failed to decrypt token:', error);
      await ctx.reply(
        '❌ Не удалось расшифровать токен бота.',
        {
          reply_markup: getBackButtonKeyboard(),
        }
      );
      return;
    }

    console.log(`🗑️  Удаление webhook для бота ${bot.id} (${bot.name})`);

    // Удаляем webhook через Telegram API
    try {
      const result = await deleteWebhook(decryptedToken);
      
      if (result.ok) {
        // Обновляем статус в базе данных
        await updateWebhookStatus(bot.id, userId, false);
        
        await ctx.reply(
          `✅ <b>Webhook успешно удален!</b>\n\n` +
          `🤖 Бот: <b>${bot.name}</b>\n` +
          `🆔 ID: <code>${bot.id}</code>\n\n` +
          `Бот больше не будет получать обновления через роутер.`,
          {
            parse_mode: 'HTML',
            reply_markup: getBackButtonKeyboard(),
          }
        );
        console.log(`✅ Webhook удален для бота ${bot.id}`);
      } else {
        throw new Error(result.description || 'Unknown error');
      }
    } catch (error) {
      console.error(`❌ Ошибка при удалении webhook для бота ${bot.id}:`, error);
      
      const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
      
      await ctx.reply(
        `❌ <b>Не удалось удалить webhook</b>\n\n` +
        `Ошибка: ${errorMessage}`,
        {
          parse_mode: 'HTML',
          reply_markup: getBackButtonKeyboard(),
        }
      );
    }
  } catch (error) {
    console.error('Error in handleDeleteWebhook:', error);
    await ctx.reply(
      '❌ Произошла ошибка при удалении webhook.',
      {
        reply_markup: getBackButtonKeyboard(),
      }
    );
  }
}

