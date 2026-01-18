# 🔧 Исправление: Vercel отдает исходный код вместо выполнения сервера

## ❌ Проблема

Health Check API (`/health`) возвращает исходный JavaScript код вместо JSON ответа.

**Причина:** Vercel не запускает сервер, а отдает статические файлы.

## ✅ Решение

### Шаг 1: Проверить настройки Vercel

В Vercel для проекта `packages/core`:

1. Откройте **Settings → Build and Deployment**
2. Проверьте следующие настройки:

#### Root Directory
- **Значение:** `packages/core`
- ✅ Уже настроено

#### Framework Preset
- **Значение:** `Other` или `Other (Node.js)`
- ⚠️ НЕ должно быть `Static` или `Static HTML`

#### Build Command
- **С Override включен:**
  ```
  cd ../.. && npm run build --filter=@dialogue-constructor/shared...@dialogue-constructor/core
  ```
  
  Или проще:
  ```
  cd ../.. && npm run build
  ```

#### Output Directory
- **Значение:** `dist`
- ⚠️ Убедитесь, что это указано

#### Install Command
- **С Override включен:**
  ```
  cd ../.. && npm install
  ```

#### Start Command (ВАЖНО!)
- **С Override включен:**
  ```
  npm start
  ```
  
  ⚠️ **Это критично!** Без Start Command сервер не запустится!

### Шаг 2: Создать vercel.json (если его нет)

Создайте файл `packages/core/vercel.json`:

```json
{
  "version": 2,
  "builds": [
    {
      "src": "dist/index.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "dist/index.js"
    }
  ]
}
```

### Шаг 3: Проверить, что сервер запускается

После пересборки проверьте логи Vercel:

1. **Deployments** → последний деплой → **Logs**
2. Ищите сообщение:
   ```
   Server is running on port 3000
   ```
   
   Или:
   ```
   Server is running on port ${PORT}
   ```

3. Если этого сообщения нет - сервер не запускается

### Шаг 4: Альтернативное решение (если не работает)

Если проблема сохраняется, используйте serverless function:

#### Вариант A: Использовать Vercel Serverless Functions

1. **Root Directory:** оставьте `packages/core`

2. **Build Command:**
   ```
   cd ../.. && npm run build --filter=@dialogue-constructor/shared...@dialogue-constructor/core
   ```

3. **Output Directory:** оставьте `dist`

4. **Start Command:** уберите (оставьте пустым)

5. Создайте файл `packages/core/api/index.js` (это будет serverless function):

```javascript
const { handler } = require('../dist/index');

module.exports = handler;
```

6. Обновите `packages/core/src/index.ts` чтобы экспортировать handler:

```typescript
export const handler = app; // Добавьте это в конце файла
```

Но это сложнее. Лучше использовать вариант ниже.

#### Вариант B: Использовать Express как serverless function (рекомендуется)

1. Создайте файл `packages/core/api/index.js`:

```javascript
const app = require('../dist/index');
module.exports = app;
```

2. В `packages/core/src/index.ts` в конце файла добавьте:

```typescript
// Export for Vercel serverless
export default app;
```

3. Обновите `packages/core/vercel.json`:

```json
{
  "version": 2,
  "builds": [
    {
      "src": "dist/index.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "/api/index.js"
    }
  ]
}
```

## 🎯 Рекомендуемое решение

### Самый простой вариант:

1. **В Vercel Settings:**
   - **Root Directory:** `packages/core`
   - **Build Command (Override):** `cd ../.. && npm run build`
   - **Output Directory:** `dist`
   - **Install Command (Override):** `cd ../.. && npm install`
   - **Start Command (Override):** `npm start`
   - **Framework Preset:** `Other` или `Other (Node.js)`

2. **Проверьте `packages/core/package.json`:**
   - Должен быть `"start": "node dist/index.js"`

3. **Пересоберите проект:**
   - Deployments → последний деплой → ⋮ → Redeploy

4. **Проверьте логи:**
   - Должно быть: `Server is running on port 3000`
   - Должно быть: `✅ Telegram bot started successfully`

## 🔍 Проверка

После исправления:

1. **Health Check API:**
   ```
   https://lego-bot-core.vercel.app/health
   ```
   Должен вернуть JSON:
   ```json
   {
     "status": "ok",
     "databases": {
       "postgres": "connected",
       "redis": "connected"
     }
   }
   ```

2. **Логи Vercel:**
   - Deployments → Logs
   - Должно быть: `Server is running on port 3000`
   - Должно быть: `✅ Telegram bot started successfully`

## ⚠️ Важно

- **Start Command обязателен!** Без него сервер не запустится
- **Framework Preset не должен быть "Static"** - это для статических сайтов
- **Root Directory должен быть `packages/core`** - не корень проекта
