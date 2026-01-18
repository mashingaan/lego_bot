# 🔗 Как получить Connection String для Supabase

## ❌ Что НЕ использовать

**Project URL** (`https://xwjeqndacvzurtnozgya.supabase.co`) - это **НЕ** то, что нужно!

Это URL для REST API Supabase, а не для прямого подключения к PostgreSQL.

## ✅ Что нужно

Для `DATABASE_URL` в Vercel нужен **Connection String (Connection URI)** для PostgreSQL.

## 📋 Как найти Connection String

### Шаг 1: Перейти в Settings → Database

1. В левой панели Supabase найдите иконку **Database** (иконка базы данных)
2. Или найдите вкладку **Settings** (шестеренка ⚙️)
3. Нажмите на **Database**

### Шаг 2: Найти Connection String

В разделе Database Settings вы найдете:

**Вариант A: Connection String (URI)**
- Раздел "Connection string" или "Connection pooling"
- Найдите "URI" или "Connection string"
- Скопируйте строку, которая выглядит так:
  ```
  postgresql://postgres.xxxxx:ПАРОЛЬ@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
  ```

**Вариант B: Connection Parameters**
Если показаны отдельные параметры:
- Host
- Port
- Database
- User
- Password

Соберите URL в формате:
```
postgresql://USER:PASSWORD@HOST:PORT/DATABASE
```

### Шаг 3: Использовать Connection Pooling (рекомендуется)

Supabase предлагает два варианта:

1. **Transaction Mode** (для транзакций):
   ```
   postgresql://postgres.xxxxx:PASSWORD@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true&transaction_mode=transaction
   ```

2. **Session Mode** (для сессий):
   ```
   postgresql://postgres.xxxxx:PASSWORD@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true&transaction_mode=session
   ```

**Рекомендуется:** Использовать **Transaction Mode** для вашего проекта.

## 📝 Полный путь в Supabase

1. **Откройте проект** `lego-bot-api` в Supabase
2. **Левая панель** → Найдите иконку **Database** (база данных) или **Settings** (шестеренка)
3. **Settings** → **Database**
4. Прокрутите до раздела **"Connection string"** или **"Connection pooling"**
5. **Скопируйте Connection String (URI)**

## ✅ Формат правильного DATABASE_URL

Для Vercel используйте:

```
postgresql://postgres.xxxxx:ВАШ_ПАРОЛЬ@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true&transaction_mode=transaction
```

Где:
- `xxxxx` - ваш идентификатор проекта
- `ВАШ_ПАРОЛЬ` - пароль, который вы задали при создании проекта (`xiKfa1-cetsus-negqys`)
- `aws-0-eu-central-1.pooler.supabase.com` - хост (может отличаться в зависимости от региона)
- `6543` - порт для Connection Pooling
- `postgres` - название базы данных

## ⚠️ Важно

- **НЕ используйте** Project URL (`https://xwjeqndacvzurtnozgya.supabase.co`)
- **Используйте** Connection String (URI) из Settings → Database
- **Рекомендуется** использовать Connection Pooling для продакшена

## 🔍 Где именно в Supabase

1. **Способ 1:** Settings → Database → Connection string
2. **Способ 2:** Settings → Database → Connection pooling → URI

## 📝 После получения Connection String

1. Скопируйте Connection String
2. В Vercel: Settings → Environment Variables
3. Найдите `DATABASE_URL`
4. Замените значение на скопированный Connection String
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

