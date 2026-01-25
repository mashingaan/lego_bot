# Shared Package

## Logger Usage

### Basic usage
const logger = createLogger('service-name');
logger.info('Message', { context });

### With request context
const requestLogger = createChildLogger(logger, { requestId, userId });

### Log levels
- error: Ошибки, требующие внимания
- warn: Предупреждения
- info: Информационные сообщения (по умолчанию)
- debug: Детальная отладочная информация

### Log files and rotation (non-Vercel)
Enable rotating JSON logs to file with `LOG_TO_FILE=true` (optional `LOG_FILE_PATH=logs/app.log`). Rotation settings:
- `LOG_SIZE_MB` (default 100)
- `LOG_INTERVAL` (default 1d)
- `LOG_MAX_FILES` (default 30)
- `LOG_COMPRESS` (true/false)
Vercel stays JSON-to-stdout only.

### Metrics logging
logger.info('Operation completed', {
  metric: 'operation_name',
  duration: 123,
  success: true
});

## Диаграмма потока логирования

```mermaid
sequenceDiagram
    participant Client
    participant Express
    participant RequestID
    participant Metrics
    participant Logger
    participant Service
    participant Vercel

    Client->>Express: HTTP Request
    Express->>RequestID: Generate Request ID
    RequestID->>Express: Add to req.id & header
    Express->>Metrics: Start timer
    Express->>Logger: Log request start
    Logger->>Vercel: JSON log entry
    Express->>Service: Process request
    Service->>Logger: Log operations
    Logger->>Vercel: JSON log entries
    Service->>Express: Return response
    Express->>Metrics: Calculate duration
    Metrics->>Logger: Log metrics
    Logger->>Vercel: JSON metrics entry
    Express->>Client: HTTP Response (with X-Request-ID)
```

## Структура логов

| Компонент | Уровень | Контекст | Метрики |
|-----------|---------|----------|---------|
| HTTP Request | info | method, path, requestId, userId | duration, statusCode, bodySize |
| DB Query | info | operation, table, requestId | duration, rowCount |
| Telegram API | info | method, chatId, botId | duration, success |
| Webhook | info | botId, userId, updateType | processingTime |
| Error | error | requestId, userId, stack | errorType, errorCode |
