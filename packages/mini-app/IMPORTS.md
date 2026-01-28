# Структура импортов в Mini App

## Правила импорта из shared пакета

### ✅ Правильно
```typescript
import { BotSchema } from '@dialogue-constructor/shared/browser';
import type { AnalyticsEvent } from '../types'; // реэкспорт из /browser
```

### ❌ Неправильно
```typescript
import { BotSchema } from '@dialogue-constructor/shared'; // основной entry point
import { middleware } from '@dialogue-constructor/shared/server'; // серверные модули
```

## Browser-safe модули

Следующие модули доступны через `/browser` entry point:
- Типы: `BotSchema`, `AnalyticsEvent`, `MediaContent`, и др.
- Константы: `BOT_LIMITS`, `RATE_LIMITS` (browser-safe версии)
- Валидация: Zod схемы
- Утилиты: `sanitizeHtml`, `sanitizeText`, `sanitizeBotSchema`

## Stub для серверных модулей

Файл `src/stubs/shared-server.ts` предотвращает случайные импорты серверных модулей, выбрасывая ошибку при попытке импорта.
