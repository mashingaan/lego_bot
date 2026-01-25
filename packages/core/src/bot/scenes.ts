import { Scenes, Context } from 'telegraf';
import { createBot, botExistsByToken, updateWebhookStatus } from '../db/bots';
import { getCancelButtonKeyboard, getMainMenuKeyboard } from './keyboards';
import { encryptToken } from '../utils/encryption';
import { setWebhook } from '../services/telegram-webhook';

// Интерфейс для данных сессии
interface BotCreationSession {
  step: 'waiting_for_token' | 'waiting_for_name' | null;
  token?: string;
  name?: string;
}

// Расширение контекста для хранения данных сессии
interface BotWizardSession extends Scenes.WizardSession {
  botCreation: BotCreationSession;
  cursor: number; // Требуется для WizardSession
}

export interface BotWizardContext extends Context, Scenes.WizardContext<BotWizardSession> {}

// Сцена создания бота
export const createBotScene = new Scenes.WizardScene<BotWizardContext>(
  'create_bot',
  async (ctx: BotWizardContext) => {
    // Инициализация сессии
    if (!ctx.scene.session.botCreation) {
      ctx.scene.session.botCreation = {
        step: 'waiting_for_token',
      };
    }
    if (typeof ctx.scene.session.cursor === 'undefined') {
      ctx.scene.session.cursor = 0;
    }

    // Отправляем инструкцию
    const instruction = `
🤖 <b>Создание нового бота</b>

Для создания бота выполните следующие шаги:

1️⃣ Откройте <a href="https://t.me/BotFather">@BotFather</a> в Telegram

2️⃣ Отправьте команду:
<code>/newbot</code>

3️⃣ Следуйте инструкциям BotFather:
   • Придумайте имя для вашего бота
   • Придумайте username (должен заканчиваться на "bot")

4️⃣ После создания бота BotFather пришлет вам токен

5️⃣ Скопируйте и пришлите мне токен бота

Токен выглядит примерно так:
<code>123456789:ABCdefGHIjklMNOpqrsTUVwxyz</code>

⚠️ <b>Важно:</b> Не делитесь токеном ни с кем, кроме этого бота!
`;

    await ctx.reply(instruction, {
      parse_mode: 'HTML',
      reply_markup: getCancelButtonKeyboard(),
    });
    ctx.scene.session.botCreation.step = 'waiting_for_token';
    return ctx.wizard.next();
  },
  
  async (ctx: BotWizardContext) => {
    // Шаг 1: Получение токена
    const message = ctx.message;
    
    if (!message || !('text' in message)) {
      await ctx.reply('❌ Пожалуйста, отправьте текстовое сообщение с токеном бота.');
      return;
    }

    const token = message.text.trim();

    // Валидация токена
    if (!token.match(/^\d+:[A-Za-z0-9_-]+$/)) {
      await ctx.reply(
        '❌ Неверный формат токена. Токен должен выглядеть так: <code>123456789:ABCdefGHIjklMNOpqrsTUVwxyz</code>',
        { parse_mode: 'HTML' }
      );
      return;
    }

    // Проверка, не существует ли уже такой токен
    // Шифруем токен для проверки в БД (токены хранятся в зашифрованном виде)
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (encryptionKey) {
      try {
        const encryptedTokenForCheck = encryptToken(token, encryptionKey);
        const exists = await botExistsByToken(encryptedTokenForCheck);
        if (exists) {
          await ctx.reply('❌ Бот с таким токеном уже зарегистрирован в системе.');
          return ctx.scene.leave();
        }
      } catch (error) {
        console.error('Error checking token existence:', error);
        // Продолжаем, если не удалось проверить (может быть первый бот без ключа)
      }
    }

    // Сохраняем токен в сессии
    ctx.scene.session.botCreation.token = token;
    ctx.scene.session.botCreation.step = 'waiting_for_name';

    await ctx.reply(
      '✅ Токен принят!\n\n📝 Теперь придумайте название для вашего бота (до 100 символов):',
      {
        reply_markup: getCancelButtonKeyboard(),
      }
    );
    return ctx.wizard.next();
  },
  
  async (ctx: BotWizardContext) => {
    // Шаг 2: Получение названия
    const message = ctx.message;
    
    if (!message || !('text' in message)) {
      await ctx.reply('❌ Пожалуйста, отправьте название бота текстом.');
      return;
    }

    const name = message.text.trim();

    if (name.length === 0) {
      await ctx.reply('❌ Название не может быть пустым.');
      return;
    }

    if (name.length > 100) {
      await ctx.reply('❌ Название слишком длинное (максимум 100 символов).');
      return;
    }

    // Сохраняем название
    ctx.scene.session.botCreation.name = name;

    try {
      // Создаем бота в базе данных
      const userId = ctx.from?.id;
      if (!userId) {
        await ctx.reply('❌ Не удалось определить ваш ID пользователя.');
        return ctx.scene.leave();
      }

      // Шифруем токен перед сохранением
      const encryptionKey = process.env.ENCRYPTION_KEY;
      if (!encryptionKey) {
        await ctx.reply('❌ Ошибка конфигурации: ENCRYPTION_KEY не установлен. Обратитесь к администратору.');
        return ctx.scene.leave();
      }

      const originalToken = ctx.scene.session.botCreation.token!;
      const encryptedToken = encryptToken(originalToken, encryptionKey);

      const botData = {
        user_id: userId,
        token: encryptedToken, // Сохраняем зашифрованный токен
        name: ctx.scene.session.botCreation.name!,
      };

      const bot = await createBot(botData);
      console.log(`✅ Bot created: ${bot.id} (${bot.name})`);

      // Настраиваем webhook автоматически после создания бота
      const routerUrl = process.env.ROUTER_URL || process.env.WEBHOOK_URL || 'http://localhost:3001';
      const webhookUrl = `${routerUrl}/webhook/${bot.id}`;
      
      let webhookSet = false;
      try {
        console.log(`🔗 Настройка webhook для бота ${bot.id}: ${webhookUrl}`);
        const webhookResult = await setWebhook(
          originalToken,
          webhookUrl,
          bot.webhook_secret || undefined,
          ['message', 'callback_query']
        ); // Используем оригинальный токен для API
        
        if (webhookResult.ok) {
          webhookSet = true;
          await updateWebhookStatus(bot.id, userId, true);
          console.log(`✅ Webhook установлен для бота ${bot.id}`);
        } else {
          console.error(`❌ Не удалось установить webhook: ${webhookResult.description}`);
        }
      } catch (error) {
        console.error(`❌ Ошибка при настройке webhook для бота ${bot.id}:`, error);
        // Не прерываем процесс создания, просто логируем ошибку
      }

      let successMessage = `✅ <b>Бот успешно создан!</b>\n\n` +
        `🆔 ID: <code>${bot.id}</code>\n` +
        `📛 Название: ${bot.name}\n` +
        `📅 Создан: ${new Date(bot.created_at).toLocaleString('ru-RU')}\n`;

      if (webhookSet) {
        successMessage += `\n🔗 <b>Webhook настроен успешно!</b>\n` +
          `URL: <code>${webhookUrl}</code>`;
      } else {
        successMessage += `\n⚠️ <b>Webhook не настроен</b>\n` +
          `Используйте команду <code>/setwebhook ${bot.id}</code> для настройки.`;
      }

      await ctx.reply(successMessage, {
        parse_mode: 'HTML',
        reply_markup: getMainMenuKeyboard(),
      });
    } catch (error) {
      console.error('Error creating bot:', error);
      await ctx.reply('❌ Произошла ошибка при создании бота. Попробуйте позже.');
    }

    return ctx.scene.leave();
  }
);

// Обработчик кнопки "Отмена" в сцене
createBotScene.action('cancel_action', async (ctx: BotWizardContext) => {
  await ctx.answerCbQuery('Создание бота отменено');
  await ctx.reply('❌ Создание бота отменено.', {
    reply_markup: getMainMenuKeyboard(),
  });
  return ctx.scene.leave();
});

