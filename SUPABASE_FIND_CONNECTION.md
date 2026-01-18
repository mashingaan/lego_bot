# 🔍 Как найти Connection String в Supabase

## ❌ Вы сейчас не там!

Вы находитесь в разделе **Authentication → URL Configuration**. Это для настройки авторизации, а не для Connection String базы данных.

## ✅ Где найти Connection String

### Способ 1: Через Database (рекомендуется)

1. **В левой панели** найдите иконку **Database** (📊 база данных)
   - НЕ Authentication (👤 человек)
   - НЕ Storage (📁 папка)
   - НЕ Edge Functions (🚀 ракета)
   - **Database** (📊 база данных)

2. Нажмите на **Database**

3. В разделе Database:
   - Найдите **"Configuration"** в левой панели
   - Нажмите на **"Connection Info"** или **"Connection Parameters"**
   - Там будет **Connection String (URI)**

### Способ 2: Через Project Settings

1. **В верхней панели** рядом с названием проекта `lego-bot-api`
2. Найдите иконку **Settings** (⚙️) или кнопку **"Project Settings"**
3. Нажмите на нее
4. В меню выберите **"Database"**
5. Найдите раздел **"Connection string"** или **"Connection pooling"**
6. Скопируйте **URI**

### Способ 3: На домашней странице

1. **Левая панель** → **Home** (иконка дома 🏠)
2. Найдите раздел **"Connect to your project"**
3. Прокрутите до раздела **"Database"**
4. Там будет **Connection String**

## 📋 Формат Connection String

Connection String выглядит так:

```
postgresql://postgres.xwjeqndacvzurtnozgya:xiKfa1-cetsus-negqys@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true&transaction_mode=transaction
```

Или:

```
postgresql://postgres.xwjeqndacvzurtnozgya:xiKfa1-cetsus-negqys@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
```

## 🎯 Быстрый путь

1. **Левая панель** → **Database** (📊)
2. **Configuration** → **Connection Info**
3. Скопируйте **URI** или **Connection String**

## ⚠️ Важно

- **Authentication** - это НЕ то, что нужно
- **Database** - это то, что нужно
- Connection String находится в разделе **Database**, а не **Authentication**

## 📝 После получения Connection String

1. Скопируйте Connection String
2. В Vercel: Settings → Environment Variables
3. Найдите `DATABASE_URL`
4. Замените значение на Connection String
5. Сохраните
6. Пересоберите проект (Redeploy)

