# 🔗 Connection String для вашего Supabase проекта

## ✅ Готовые Connection Strings

Так как найти Connection String в интерфейсе не получилось, вот готовые строки для вашего проекта:

### Вариант 1: Connection Pooling (рекомендуется для Vercel)

```
postgresql://postgres.xwjeqndacvzurtnozgya:xiKfa1-cetsus-negqys@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true&transaction_mode=transaction
```

**Рекомендуется использовать этот вариант!** Connection Pooling лучше работает с serverless платформами как Vercel.

### Вариант 2: Прямое подключение

```
postgresql://postgres.xwjeqndacvzurtnozgya:xiKfa1-cetsus-negqys@db.xwjeqndacvzurtnozgya.supabase.co:5432/postgres
```

Это прямое подключение к PostgreSQL (без pooling).

## 📝 Как использовать

1. **Скопируйте Вариант 1** (Connection Pooling - рекомендуется)
2. **В Vercel:**
   - Settings → Environment Variables
   - Найдите `DATABASE_URL`
   - Замените значение на скопированный Connection String
   - Сохраните
3. **Пересоберите проект:**
   - Deployments → последний деплой → ⋮ → Redeploy

## 🔍 Проверка

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

## 📋 Структура Connection String

```
postgresql://USERNAME:PASSWORD@HOST:PORT/DATABASE?PARAMETERS
```

Где:
- `postgres.xwjeqndacvzurtnozgya` - username (postgres + project ID)
- `xiKfa1-cetsus-negqys` - пароль БД
- `aws-0-eu-central-1.pooler.supabase.com` - хост для pooling (Europe)
- `6543` - порт для Connection Pooling
- `db.xwjeqndacvzurtnozgya.supabase.co` - прямой хост PostgreSQL
- `5432` - прямой порт PostgreSQL
- `postgres` - название базы данных

## ⚠️ Если не работает

Если Вариант 1 не работает:

1. Попробуйте Вариант 2 (прямое подключение)
2. Проверьте, что пароль БД правильный
3. Проверьте регион:
   - Если проект в другом регионе, измените хост:
   - `us-east-1` для США
   - `eu-central-1` для Европы (текущий)
   - `ap-southeast-1` для Азии

## 🎯 Рекомендация

Используйте **Вариант 1** (Connection Pooling) - он оптимизирован для serverless и лучше работает с Vercel.

