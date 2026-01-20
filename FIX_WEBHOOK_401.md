# Исправление ошибки 401 Unauthorized для webhook

## Проблема

Webhook получает ошибку `401 Unauthorized` и использует preview URL вместо production URL.

## Решение

### Шаг 1: Узнайте ваш Production URL

1. Откройте Vercel Dashboard → проект `lego-bot-core`
2. Перейдите в **Settings** → **Domains**
3. Найдите production domain (обычно `lego-bot-core.vercel.app` или ваш custom domain)

### Шаг 2: Установите webhook на Production URL

Откройте в браузере (замените `YOUR_PRODUCTION_URL` на ваш production URL):

```
https://api.telegram.org/bot8585269589:AAGNheAjAdj5p6FJ6Xi-NCZk-fW3g1wYFDQ/setWebhook?url=https://YOUR_PRODUCTION_URL/api/webhook
```

**Пример для production:**
```
https://api.telegram.org/bot8585269589:AAGNheAjAdj5p6FJ6Xi-NCZk-fW3g1wYFDQ/setWebhook?url=https://lego-bot-core.vercel.app/api/webhook
```

### Шаг 3: Проверьте установку

```
https://api.telegram.org/bot8585269589:AAGNheAjAdj5p6FJ6Xi-NCZk-fW3g1wYFDQ/getWebhookInfo
```

Должно быть:
- `url`: ваш production URL (не preview URL)
- `pending_update_count`: должно уменьшиться после обработки
- `last_error_message`: должно быть пустым или отсутствовать

### Шаг 4: Проверьте логи Vercel

После установки webhook на production URL:
1. Отправьте команду `/start` боту
2. Проверьте логи Vercel - должны появиться записи о получении webhook

## Почему возникает 401?

Preview deployments на Vercel могут требовать аутентификацию или иметь ограниченный доступ. Production deployments всегда доступны публично.

## Альтернатива: Использовать команду бота

Если у вас есть команда `/setup_webhook` в боте, она должна автоматически установить правильный production URL.

