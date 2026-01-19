# Развертывание Mini App на Vercel

## Вариант 1: Через Vercel Dashboard (рекомендуется)

### Шаг 1: Подготовка репозитория

1. Убедитесь, что все изменения отправлены в GitHub:
   ```bash
   git add .
   git commit -m "Prepare for Vercel deployment"
   git push
   ```

### Шаг 2: Создание проекта в Vercel

1. Перейдите на [vercel.com](https://vercel.com)
2. Войдите через GitHub аккаунт
3. Нажмите **"Add New Project"** или **"Import Project"**
4. Выберите ваш репозиторий `lego_bot`

### Шаг 3: Настройка проекта

**Важно:** Настройте проект для папки `packages/mini-app`

1. В разделе **"Configure Project"** укажите:
   - **Root Directory**: `packages/mini-app`
   - **Framework Preset**: `Vite` (будет определен автоматически)
   - **Build Command**: `npm run build` (или оставьте пустым)
   - **Output Directory**: `dist` (или оставьте пустым)
   - **Install Command**: `npm install` (или оставьте пустым)

2. Нажмите **"Deploy"**

### Шаг 4: Настройка переменных окружения

После первого деплоя:

1. Перейдите в **Settings** → **Environment Variables**
2. Добавьте переменные:

   ```
   VITE_API_URL = https://lego-bot-core.vercel.app
   VITE_TON_CONNECT_MANIFEST_URL = https://your-project-name.vercel.app/tonconnect-manifest.json
   ```

   **Важно:** Замените `your-project-name` на реальное имя вашего проекта на Vercel

3. После добавления переменных, сделайте **Redeploy** (Settings → Deployments → три точки → Redeploy)

### Шаг 5: Обновление TON Connect Manifest

1. После деплоя скопируйте URL вашего проекта (например: `https://lego-bot-mini-app.vercel.app`)
2. Обновите `public/tonconnect-manifest.json`:

   ```json
   {
     "url": "https://lego-bot-mini-app.vercel.app",
     "name": "Dialogue Constructor",
     "iconUrl": "https://lego-bot-mini-app.vercel.app/icon.png"
   }
   ```

3. Закоммитьте изменения и отправьте в GitHub:
   ```bash
   git add packages/mini-app/public/tonconnect-manifest.json
   git commit -m "Update TON Connect manifest URL"
   git push
   ```

4. Vercel автоматически сделает новый деплой

## Вариант 2: Через Vercel CLI

### Шаг 1: Установка Vercel CLI

```bash
npm install -g vercel
```

### Шаг 2: Вход в Vercel

```bash
vercel login
```

### Шаг 3: Деплой

```bash
cd packages/mini-app
vercel
```

Следуйте инструкциям:
- **Set up and deploy?** → `Y`
- **Which scope?** → выберите ваш аккаунт
- **Link to existing project?** → `N` (для первого деплоя)
- **What's your project's name?** → введите имя (например: `lego-bot-mini-app`)
- **In which directory is your code located?** → `./` (оставьте по умолчанию)

### Шаг 4: Настройка переменных окружения

```bash
vercel env add VITE_API_URL
# Введите значение: https://lego-bot-core.vercel.app

vercel env add VITE_TON_CONNECT_MANIFEST_URL
# Введите значение: https://your-project-name.vercel.app/tonconnect-manifest.json
```

### Шаг 5: Production деплой

```bash
vercel --prod
```

## Проверка деплоя

1. Откройте URL вашего проекта (будет показан после деплоя)
2. Проверьте, что приложение загружается
3. Откройте консоль браузера (F12) и убедитесь, что нет ошибок
4. Проверьте доступность `tonconnect-manifest.json`:
   - Откройте: `https://your-project.vercel.app/tonconnect-manifest.json`
   - Должен вернуться JSON файл

## Настройка бота после деплоя

1. Откройте [@BotFather](https://t.me/BotFather)
2. Отправьте `/mybots`
3. Выберите вашего бота
4. Выберите **"Bot Settings"** → **"Menu Button"**
5. Укажите:
   - **Text**: `Открыть конструктор`
   - **URL**: `https://your-project.vercel.app`

## Переменные окружения

Убедитесь, что в Vercel настроены следующие переменные:

| Переменная | Описание | Пример |
|-----------|----------|--------|
| `VITE_API_URL` | URL основного API сервера | `https://lego-bot-core.vercel.app` |
| `VITE_TON_CONNECT_MANIFEST_URL` | URL TON Connect манифеста | `https://your-project.vercel.app/tonconnect-manifest.json` |

**Важно:** Переменные с префиксом `VITE_` доступны только в клиентском коде.

## Автоматический деплой

После настройки, каждый `git push` в `main` ветку автоматически сделает новый деплой на Vercel.

## Troubleshooting

### Ошибка: "Build failed"

1. Проверьте логи в Vercel Dashboard
2. Убедитесь, что `package.json` корректен
3. Проверьте, что все зависимости установлены

### Ошибка: "404 Not Found" для роутов

Убедитесь, что в `vercel.json` настроен `rewrites` для всех путей на `index.html`

### Ошибка: "API URL not found"

1. Проверьте переменную окружения `VITE_API_URL`
2. Убедитесь, что API сервер доступен
3. Сделайте Redeploy после изменения переменных

### Telegram WebApp не работает

1. Убедитесь, что открываете через Telegram (не просто в браузере)
2. Проверьте, что скрипт `telegram-web-app.js` загружается (Network tab в DevTools)
3. Убедитесь, что URL правильный в настройках бота

