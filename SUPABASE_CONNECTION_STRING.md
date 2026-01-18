# 🔗 Где найти Connection String в Supabase

## 📍 Вы сейчас на странице Database Settings

На этой странице есть настройки, но **Connection String здесь не отображается**.

## 🔍 Где найти Connection String

### Способ 1: Connection Info (самый простой)

1. **В левой панели** (где вы сейчас в разделе Database)
2. Найдите раздел **"Configuration"**
3. НАД пунктом "Settings" должен быть пункт **"Connection Info"** или **"Connection Parameters"**
4. Нажмите на него
5. Там будет **Connection String (URI)**

### Способ 2: Через Project Settings

1. **В верхней панели** рядом с названием проекта `lego-bot-api`
2. Найдите иконку **Settings** (⚙️) или кнопку **"Project Settings"**
3. Нажмите на нее
4. В меню выберите **"Database"**
5. Найдите раздел **"Connection string"** или **"Connection pooling"**
6. Скопируйте **URI** или **Connection String**

### Способ 3: Через API Settings

1. **Левая панель** → Найдите иконку **API** (иконка кода `<>`)
2. Нажмите на нее
3. Найдите раздел **"Database"** или **"Connection"**
4. Там должен быть **Connection String**

### Способ 4: В домашней странице проекта

1. Вернитесь на **Home** (иконка дома в левой панели)
2. Найдите раздел **"Connect to your project"** или **"Database"**
3. Прокрутите до раздела **"Connection string"** или **"Connection Info"**

## 📋 Формат Connection String

Connection String выглядит примерно так:

```
postgresql://postgres.xwjeqndacvzurtnozgya:xiKfa1-cetsus-negqys@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true&transaction_mode=transaction
```

Где:
- `xwjeqndacvzurtnozgya` - идентификатор вашего проекта
- `xiKfa1-cetsus-negqys` - пароль базы данных
- `aws-0-eu-central-1.pooler.supabase.com` - хост (может отличаться)
- `6543` - порт для Connection Pooling
- `postgres` - название базы данных

## 💡 Где чаще всего находится

**Connection String обычно находится в:**

1. **Settings → Database → Connection string** (или Connection pooling)
2. **Project Settings → Database → Connection Info**
3. **Home → Connect to your project → Database**

## 🎯 Быстрая проверка

Если не можете найти Connection String, попробуйте собрать его вручную:

```
postgresql://postgres.ПРОЕКТ_ID:ПАРОЛЬ@aws-0-РЕГИОН.pooler.supabase.com:6543/postgres?pgbouncer=true&transaction_mode=transaction
```

Где:
- `ПРОЕКТ_ID` - это часть из Project URL: `xwjeqndacvzurtnozgya`
- `ПАРОЛЬ` - это пароль, который вы задали: `xiKfa1-cetsus-negqys`
- `РЕГИОН` - зависит от региона проекта (например: `eu-central-1` для Europe)

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

