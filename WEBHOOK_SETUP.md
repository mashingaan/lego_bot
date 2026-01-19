# Настройка Webhook для основного бота

## Проблема

На Vercel бот не может работать через long polling (постоянное соединение), поэтому нужно настроить webhook.

## Решение

### Шаг 1: Настройка webhook через команду в боте

1. Откройте вашего бота в Telegram
2. Отправьте команду `/setup_webhook`
3. Бот настроит webhook автоматически

### Шаг 2: Настройка webhook вручную через Telegram API

1. Получите URL вашего API:
   - Например: `https://lego-bot-core.vercel.app`
   - URL можно найти в Vercel Dashboard

2. Откройте в браузере (замените `YOUR_BOT_TOKEN` на токен вашего основного бота):
   ```
   https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=https://lego-bot-core.vercel.app/api/webhook
   ```

3. Должен вернуться ответ:
   ```json
   {"ok":true,"result":true,"description":"Webhook was set"}
   ```

### Шаг 3: Проверка webhook

Проверьте, что webhook установлен:
```
https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo
```

Должен вернуться:
```json
{
  "ok": true,
  "result": {
    "url": "https://lego-bot-core.vercel.app/api/webhook",
    "has_custom_certificate": false,
    "pending_update_count": 0
  }
}
```

### Шаг 4: Тестирование

1. Отправьте команду `/start` боту
2. Бот должен ответить приветственным сообщением

## Переменные окружения в Vercel

Убедитесь, что в Vercel установлены:

- `TELEGRAM_BOT_TOKEN` - токен основного бота
- `VERCEL_URL` - автоматически устанавливается Vercel (или `API_URL` вручную)
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `ENCRYPTION_KEY` - ключ шифрования токенов
- `MINI_APP_URL` - URL Mini App (для CORS)

## Troubleshooting

### Бот не отвечает на команды

1. Проверьте, что webhook установлен через `/setup_webhook` или вручную
2. Проверьте логи Vercel - должны быть сообщения о получении обновлений
3. Убедитесь, что `TELEGRAM_BOT_TOKEN` правильный

### Ошибка "Bot not initialized"

1. Проверьте, что `TELEGRAM_BOT_TOKEN` установлен в Vercel
2. Проверьте логи Vercel при старте функции
3. Убедитесь, что бот инициализируется (должно быть сообщение "Bot configured for webhook mode")

### Mini App не загружается

1. Проверьте CORS настройки в `packages/core/src/index.ts`
2. Убедитесь, что `MINI_APP_URL` правильный
3. Проверьте, что Mini App деплоится успешно
4. Убедитесь, что открываете Mini App через Telegram, а не в браузере

