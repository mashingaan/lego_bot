# 🔧 Исправление ошибки сборки на Vercel: Cannot find module '@dialogue-constructor/shared'

## Проблема

При деплое на Vercel возникает ошибка:
```
error TS2307: Cannot find module '@dialogue-constructor/shared/types/bot-schema'
```

Это происходит потому, что при сборке `packages/core` с `Root Directory: packages/core` пакет `packages/shared` не собирается перед `core`.

## ✅ Решение

### Вариант 1: Изменить Build Command в Vercel (рекомендуется)

В настройках Vercel проекта (`packages/core`):

1. Откройте **Settings** → **Build and Deployment**
2. В разделе **Build Command**:
   - Включите **Override**
   - Замените команду на:
     ```bash
     cd ../.. && npm run build --filter=@dialogue-constructor/shared...@dialogue-constructor/core
     ```
   
   Или проще:
   ```bash
     cd ../.. && npm run build
     ```
   
   Это соберет весь проект (включая shared перед core) благодаря turbo.json

3. Убедитесь, что:
   - **Root Directory:** `packages/core`
   - **Install Command:** `cd ../.. && npm install` (или просто `npm install`, если включен "Include files outside root")
   - **Output Directory:** `dist`

### Вариант 2: Убрать Root Directory (альтернатива)

Если вариант 1 не работает:

1. В настройках Vercel:
   - **Root Directory:** оставьте пустым (корень проекта)
   
2. Измените **Build Command**:
   ```bash
   npm run build --filter=@dialogue-constructor/core
   ```
   
   Или:
   ```bash
   cd packages/core && npm run build
   ```

3. **Output Directory:** `packages/core/dist`

### Вариант 3: Использовать turbo build (если turbo установлен)

Если turbo доступен в Vercel:

1. **Build Command:**
   ```bash
   cd ../.. && npx turbo build --filter=@dialogue-constructor/core
   ```

2. Turbo автоматически соберет зависимости (`@dialogue-constructor/shared`) перед core

## 📝 Проверка

После настройки убедитесь, что:

1. `packages/shared` собирается перед `packages/core`
2. Импорты используют `@dialogue-constructor/shared` (не прямой путь)
3. В логах Vercel видно, что shared собран перед core

## ✅ Исправления в коде (уже внесены)

1. ✅ Изменены импорты в `packages/core/src/db/bots.ts`:
   ```typescript
   // Было:
   import { BotSchema } from '@dialogue-constructor/shared/types/bot-schema';
   
   // Стало:
   import { BotSchema } from '@dialogue-constructor/shared';
   ```

2. ✅ Изменены импорты в `packages/core/src/bot/schema-commands.ts`

3. ✅ Создан `packages/core/vercel.json` (может использоваться Vercel)

## 🎯 Рекомендация

**Используйте Вариант 1** - измените Build Command на сборку из корня проекта. Это самый простой и надежный способ.

