# 🔗 Где найти Connection String в Supabase

## ❌ Это не та страница!

Вы сейчас в разделе **Settings → API Keys**. Это для REST API Supabase, а не для Connection String PostgreSQL.

## ✅ Где найти Connection String

### Способ 1: Через Database в левой панели (самый простой)

1. **В левой панели** (основная навигация, не Settings)
2. Найдите иконку **Database** (📊 база данных)
3. Нажмите на **Database**
4. В разделе Database:
   - Найдите **"Configuration"** в левой панели
   - Нажмите на **"Connection Info"** или **"Connection Parameters"**
   - Там будет **Connection String (URI)**

### Способ 2: Через Settings → Database

1. **В левой панели Settings** (где вы сейчас)
2. Найдите раздел **"CONFIGURATION"**
3. Нажмите на **"Database"** (НЕ "API Keys")
4. В разделе Database Settings:
   - Найдите **"Connection string"** или **"Connection pooling"**
   - Скопируйте **URI**

### Способ 3: Через Project Settings

1. **В верхней панели** рядом с названием проекта `lego-bot-api`
2. Найдите иконку **Settings** (⚙️) или кнопку **"Project Settings"**
3. Нажмите на нее
4. В меню выберите **"Database"**
5. Найдите раздел **"Connection string"**

## 📋 Формат Connection String

Connection String выглядит так:

```
postgresql://postgres.xwjeqndacvzurtnozgya:xiKfa1-cetsus-negqys@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true&transaction_mode=transaction
```

Или:

```
postgresql://postgres.xwjeqndacvzurtnozgya:xiKfa1-cetsus-negqys@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
```

Где:
- `xwjeqndacvzurtnozgya` - идентификатор проекта (из Project URL)
- `xiKfa1-cetsus-negqys` - пароль базы данных
- `aws-0-eu-central-1.pooler.supabase.com` - хост (может отличаться)
- `6543` - порт для Connection Pooling (рекомендуется)
- `5432` - прямой порт PostgreSQL
- `postgres` - название базы данных

## 🎯 Быстрый путь из текущей страницы

1. **В левой панели Settings** (где вы сейчас)
2. Найдите раздел **"CONFIGURATION"**
3. Нажмите на **"Database"** (НЕ "API Keys", НЕ "Authentication")
4. Найдите **"Connection string"** или **"Connection pooling"**
5. Скопируйте **URI**

## ⚠️ Важно

- **API Keys** - это НЕ то, что нужно (это для REST API)
- **Database** - это то, что нужно (для Connection String)
- Connection String находится в разделе **Database**, не в **API Keys**

## 📝 После получения Connection String

1. Скопируйте Connection String
2. В Vercel: Settings → Environment Variables
3. Найдите `DATABASE_URL`
4. Замените значение на Connection String
5. Сохраните
6. Пересоберите проект (Redeploy)

## 🧪 Проверка

После обновления `DATABASE_URL` проверьте:

```
https://lego-bot-core.vercel.app/health
```

Должен вернуть:
```json
{
  "status": "ok",
  "databases": {
    "postgres": "connected"
  }
}
```

