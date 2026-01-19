# Настройка бота для Mini App

## 1. Создание бота через @BotFather

1. Откройте [@BotFather](https://t.me/BotFather) в Telegram
2. Отправьте команду `/newbot`
3. Следуйте инструкциям:
   - **Bot name**: Dialogue Constructor (или любое другое имя)
   - **Username**: `yourdialogue_bot` (должен заканчиваться на `bot`)
4. Сохраните полученный токен

## 2. Настройка кнопки меню

После развертывания Mini App на Vercel (или другом хостинге), получите URL вашего приложения.

Затем в основном боте (`packages/core`) добавьте команду для настройки кнопки меню:

```typescript
// В packages/core/src/bot/commands.ts добавьте:
import { Telegraf } from 'telegraf';

bot.command('setmenubutton', async (ctx) => {
  const MINI_APP_URL = process.env.MINI_APP_URL || 'https://your-mini-app.vercel.app';
  
  try {
    await ctx.telegram.setChatMenuButton({
      menu_button: {
        type: 'web_app',
        text: 'Открыть конструктор',
        web_app: { url: MINI_APP_URL }
      }
    });
    
    await ctx.reply('✅ Кнопка меню успешно настроена!');
  } catch (error) {
    await ctx.reply('❌ Ошибка настройки кнопки меню');
    console.error(error);
  }
});
```

Или настройте вручную через @BotFather:

1. Откройте [@BotFather](https://t.me/BotFather)
2. Отправьте команду `/mybots`
3. Выберите вашего бота
4. Выберите "Bot Settings"
5. Выберите "Menu Button"
6. Выберите "Configure Menu Button"
7. Укажите текст кнопки: `Открыть конструктор`
8. Укажите URL вашего Mini App: `https://your-mini-app.vercel.app`

## 3. Настройка переменных окружения

В `.env` основного бота добавьте:

```env
MINI_APP_URL=https://your-mini-app.vercel.app
```

## 4. TON Connect Manifest

1. Обновите `public/tonconnect-manifest.json`:
   ```json
   {
     "url": "https://your-mini-app.vercel.app",
     "name": "Dialogue Constructor",
     "iconUrl": "https://your-mini-app.vercel.app/icon.png"
   }
   ```

2. Убедитесь, что файл доступен по URL: `https://your-mini-app.vercel.app/tonconnect-manifest.json`

3. В `.env` Mini App добавьте:
   ```env
   VITE_TON_CONNECT_MANIFEST_URL=https://your-mini-app.vercel.app/tonconnect-manifest.json
   ```

## 5. Тестирование

1. Запустите Mini App локально:
   ```bash
   cd packages/mini-app
   npm run dev
   ```

2. Используйте [@BotFather](https://t.me/BotFather) для тестирования:
   - Отправьте `/newapp`
   - Выберите вашего бота
   - Укажите название Mini App
   - Укажите URL: `http://localhost:5174` (для локального тестирования)

3. После деплоя на Vercel, обновите URL на production URL в настройках бота.

