# Mini App - Dialogue Constructor

Telegram Mini App для визуального создания и редактирования схем диалогов ботов.

## Технологии

- **React 18** - UI библиотека
- **TypeScript** - типизация
- **Vite** - сборщик
- **Telegram WebApp SDK** - интеграция с Telegram
- **React Router** - роутинг
- **TON Connect** - интеграция с TON для платежей

## Установка

```bash
npm install
```

## Разработка

```bash
npm run dev
```

Приложение будет доступно на `http://localhost:5174`

## Сборка

```bash
npm run build
```

## Настройка

1. Создайте `.env` на основе `.env.example`:

```env
VITE_API_URL=https://lego-bot-core.vercel.app
VITE_TON_CONNECT_MANIFEST_URL=https://ваш-домен.vercel.app/tonconnect-manifest.json
```

2. Обновите `public/tonconnect-manifest.json` с правильными URL вашего домена.

3. Настройте бота через @BotFather:

```
/newbot - создать бота
/setmenubutton - установить кнопку меню с web_app
```

## Структура

```
src/
├── components/     # React компоненты
│   ├── SchemaEditor.tsx  # Редактор схемы
│   ├── StateEditor.tsx   # Редактор состояния
│   └── Preview.tsx       # Предпросмотр
├── pages/          # Страницы приложения
│   ├── BotList.tsx       # Список ботов
│   ├── BotEditor.tsx     # Редактор бота
│   └── Templates.tsx     # Шаблоны
├── utils/          # Утилиты
│   └── api.ts      # API клиент
└── types/          # TypeScript типы
```

## Деплой

Разверните на Vercel или другом хостинге:

```bash
npm run build
```

Убедитесь, что:
- `VITE_API_URL` указывает на ваш API
- `tonconnect-manifest.json` доступен по публичному URL
- Бот настроен через @BotFather с правильным URL Mini App

