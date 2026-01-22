# Dialogue Constructor

Telegram-бот для создания и управления диалоговыми бота через веб-интерфейс.

## 🚀 Quick Start

**New to this project?** See [RUNBOOK.md](./RUNBOOK.md) for detailed setup instructions.

**TL;DR:**
```bash
npm install
docker-compose up -d
cd packages/core && npm run test-db
cd packages/core && npm run dev        # Terminal 1
cd packages/router && npm run dev      # Terminal 2
cd packages/mini-app && npm run dev    # Terminal 3
```

**Troubleshooting?** Check [RUNBOOK.md - Known Gotchas](./RUNBOOK.md#known-gotchas)

## 🏗️ Архитектура

Monorepo на npm workspaces + Turbo:

```
lego_bot/
├── packages/
│   ├── core/          # Основной сервер (Express + Telegraf)
│   │   ├── src/
│   │   │   ├── index.ts              # Точка входа, Express сервер + Telegram бот
│   │   │   ├── bot/                   # Логика Telegram бота
│   │   │   │   ├── commands.ts        # Обработчики команд (/start, /create_bot, etc.)
│   │   │   │   ├── scenes.ts          # FSM сцены (создание бота)
│   │   │   │   ├── keyboards.ts       # Inline клавиатуры
│   │   │   │   ├── webhook-commands.ts # Управление webhook
│   │   │   │   └── schema-commands.ts  # Редактирование схем
│   │   │   ├── db/                    # Работа с БД
│   │   │   │   ├── postgres.ts        # PostgreSQL подключение
│   │   │   │   ├── redis.ts           # Redis подключение
│   │   │   │   └── bots.ts            # CRUD операции для ботов (миграции встроены в код)
│   │   │   ├── services/
│   │   │   │   └── telegram-webhook.ts # Telegram API для webhook
│   │   │   └── utils/
│   │   │       └── encryption.ts      # AES-256-GCM шифрование токенов
│   │   └── api/                       # Vercel serverless entry point
│   │
│   ├── router/        # Webhook роутер для созданных ботов
│   │   ├── src/
│   │   │   ├── index.ts              # Express сервер для webhook
│   │   │   ├── db/                   # PostgreSQL + Redis
│   │   │   ├── services/
│   │   │   │   └── telegram.ts       # Отправка сообщений через Telegram API
│   │   │   └── utils/
│   │   │       └── encryption.ts    # Расшифровка токенов
│   │
│   ├── frontend/       # Веб-интерфейс для редактирования схем
│   │   ├── index.html  # HTML страница
│   │   ├── script.js   # Логика (API, валидация)
│   │   └── style.css   # Стили
│   │
│   ├── mini-app/       # Telegram Mini App (React + TypeScript + Vite)
│   │   ├── src/
│   │   │   ├── components/           # React компоненты
│   │   │   │   ├── SchemaEditor.tsx  # Редактор схемы
│   │   │   │   ├── StateEditor.tsx   # Редактор состояния
│   │   │   │   └── Preview.tsx       # Предпросмотр
│   │   │   ├── pages/                # Страницы
│   │   │   │   ├── BotList.tsx       # Список ботов
│   │   │   │   ├── BotEditor.tsx     # Редактор бота
│   │   │   │   └── Templates.tsx     # Шаблоны
│   │   │   └── utils/
│   │   │       └── api.ts            # API клиент
│   │   └── public/
│   │       └── tonconnect-manifest.json # TON Connect манифест
│   │
│   └── shared/         # Общие TypeScript типы
│       └── src/
│           └── types/
│               └── bot-schema.ts     # BotSchema интерфейс
│
├── docker-compose.yml  # PostgreSQL + Redis для локальной разработки
└── .env               # Переменные окружения
```

## 🚀 Быстрый старт

> **📖 Полная инструкция:** См. [RUNBOOK.md](./RUNBOOK.md) для подробного руководства по локальной разработке.

### 1. Установка зависимостей

```bash
npm install
```

### 2. Настройка окружения

Создайте `.env` в корне проекта:

```env
# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token_here

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/dialogue_constructor
REDIS_URL=redis://localhost:6379

# Encryption (минимум 32 символа)
ENCRYPTION_KEY=your-32-character-encryption-key-here

# URLs
ROUTER_URL=http://localhost:3001
FRONTEND_URL=http://localhost:8000
PORT=3000
```

### 3. Запуск локально

Рекомендуемый запуск (core + router + mini-app):

```bash
# Запустить PostgreSQL и Redis
docker-compose up -d

cd packages/core && npm run dev        # Terminal 1 (http://localhost:3000)
cd packages/router && npm run dev      # Terminal 2 (http://localhost:3001)
cd packages/mini-app && npm run dev    # Terminal 3 (http://localhost:5174)
```

Legacy/Optional UI (packages/frontend):

```bash
cd packages/frontend && python3 -m http.server 8000
```

## 📦 Пакеты

### `@dialogue-constructor/core`

**Основной сервер приложения**

- **Express API** для фронтенда (`/api/bots`, `/api/bot/:id/schema`)
- **Telegram бот** (Telegraf) с командами:
  - `/start` - приветствие
  - `/create_bot` - создание нового бота через @BotFather
  - `/my_bots` - список созданных ботов
  - `/setwebhook <bot_id>` - установка webhook
  - `/deletewebhook <bot_id>` - удаление webhook
  - `/editschema <bot_id> <json>` - редактирование схемы
- **PostgreSQL** - хранение ботов (токены зашифрованы)
- **Redis** - хранение состояний пользователей

**Структура:**
- `src/index.ts` - Express сервер + инициализация Telegram бота
- `src/bot/` - обработчики команд и сцен
- `src/db/` - работа с БД
- `src/services/` - внешние API (Telegram)
- `src/utils/` - утилиты (шифрование)

### `@dialogue-constructor/router`

**Webhook роутер для созданных ботов**

Принимает webhook от Telegram на `/webhook/:botId`, загружает схему бота из PostgreSQL, определяет состояние пользователя из Redis, отправляет сообщения согласно схеме.

**Структура:**
- `src/index.ts` - Express сервер для webhook
- `src/db/` - PostgreSQL (схемы ботов) + Redis (состояния)
- `src/services/telegram.ts` - отправка сообщений через Telegram API

### `@dialogue-constructor/frontend`

**Веб-интерфейс для редактирования схем**

Чистый HTML/CSS/JS без фреймворков:
- Ввод User ID для авторизации
- Список ботов пользователя
- JSON редактор с валидацией
- Предпросмотр схемы

**Файлы:**
- `index.html` - структура страницы
- `script.js` - логика (API запросы, валидация)
- `style.css` - стили

### `@dialogue-constructor/mini-app`

**Telegram Mini App для визуального редактирования**

React + TypeScript + Vite приложение:
- Интеграция с Telegram WebApp SDK
- Визуальный редактор схем с drag-and-drop
- Редактор состояний (сообщения + кнопки)
- Предпросмотр бота в реальном времени
- Готовые шаблоны схем
- TON Connect для платежей

**Структура:**
- `src/components/` - React компоненты
- `src/pages/` - страницы приложения
- `src/utils/api.ts` - API клиент

### `@dialogue-constructor/shared`

**Общие TypeScript типы**

- `BotSchema` - интерфейс схемы диалога

## 🔑 Ключевые концепции

### Схема бота (BotSchema)

JSON структура, описывающая диалог:

```typescript
{
  version: 1,
  initialState: "start",
  states: {
    "start": {
      message: "Привет!",
      buttons: [
        { text: "Далее", nextState: "next" }
      ]
    },
    "next": {
      message: "Второй шаг"
    }
  }
}
```

### Шифрование токенов

Токены ботов шифруются AES-256-GCM перед сохранением в PostgreSQL.

### Webhook flow

1. Пользователь отправляет сообщение боту
2. Telegram отправляет webhook на `ROUTER_URL/webhook/{botId}`
3. Router загружает схему бота из PostgreSQL
4. Определяет текущее состояние пользователя из Redis
5. Отправляет сообщение и кнопки согласно схеме
6. Обновляет состояние в Redis

## 🛠️ Разработка

### Локальная разработка

```bash
# Core
cd packages/core
npm run dev  # tsx watch src/index.ts

# Router
cd packages/router
npm run dev  # tsx watch src/index.ts

# Frontend
cd packages/frontend
python3 -m http.server 8000
```

### Сборка

```bash
npm run build  # Собирает все пакеты через Turbo
```

### Тестирование БД

```bash
cd packages/core
npm run test-db  # Проверяет подключение к PostgreSQL и Redis
```

## 🌐 Деплой

### Vercel (Core + Frontend)

**Core:**
- Root Directory: `packages/core`
- Build Command: `cd ../.. && npm run build`
- Output Directory: `dist`
- Environment Variables: все из `.env`

**Frontend:**
- Root Directory: `packages/frontend`
- Framework: Other
- Build Command: (пусто)
- Output Directory: `.`

### Router

Можно деплоить на любой хостинг (Railway, Render, etc.) или использовать Docker:

```bash
cd packages/router
docker-compose up -d
```

## 📝 API Endpoints

### Core (`packages/core`)

- `GET /health` - проверка работоспособности
- `GET /api/bots?user_id={id}` - список ботов пользователя
- `GET /api/bot/:id/schema` - получить схему бота
- `POST /api/bot/:id/schema` - обновить схему бота

### Router (`packages/router`)

- `POST /webhook/:botId` - webhook от Telegram
- `GET /health` - проверка работоспособности

## 🔐 Безопасность

- Токены ботов шифруются AES-256-GCM
- Telegram Login Widget проверяет hash через HMAC-SHA256
- Все ошибки логируются без чувствительных данных

## 📚 Зависимости

- **Express** - HTTP сервер
- **Telegraf** - Telegram Bot API
- **PostgreSQL** (pg) - основная БД
- **Redis** - кеш и состояния
- **TypeScript** - типизация
- **Turbo** - сборка monorepo

## 📄 Лицензия

MIT
