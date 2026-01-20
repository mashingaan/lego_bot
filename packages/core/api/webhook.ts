// Vercel Serverless Function для Telegram Webhook
// Отдельный endpoint для /api/webhook
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Логируем сразу в начале - это поможет понять, вызывается ли функция
  console.log('🚀 Webhook handler called');
  console.log('Method:', req.method);
  
  // Только POST запросы
  if (req.method !== 'POST') {
    console.log('❌ Method not allowed:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('📨 Webhook request received');
    console.log('Request method:', req.method);
    
    // Импортируем модуль - это инициализирует бота, если еще не инициализирован
    // @ts-ignore - dist файлы могут не иметь типов
    let coreModule;
    try {
      // Путь зависит от того, где находится файл после компиляции
      // Если файл в dist/api/webhook.js, то путь к dist/index.js будет ../index
      // Если файл в api/webhook.js (Vercel компилирует автоматически), то путь будет ../dist/index
      coreModule = require('../dist/index') || require('../index');
      console.log('✅ Core module loaded');
    } catch (importError: any) {
      console.error('❌ Failed to import core module:', importError);
      console.error('Import error stack:', importError?.stack);
      // Всегда возвращаем 200 для Telegram
      return res.status(200).json({ ok: true, error: 'Module import failed' });
    }
    
    // Получаем botInstance - он должен быть экспортирован из index.ts
    let botInstance = coreModule.botInstance || coreModule.default?.botInstance;
    
    // Если botInstance не найден, возможно модуль еще не загрузился полностью
    if (!botInstance) {
      console.warn('⚠️ Bot instance not found, waiting for initialization...');
      // Даем время на инициализацию (если она асинхронная)
      await new Promise(resolve => setTimeout(resolve, 200));
      botInstance = coreModule.botInstance || coreModule.default?.botInstance;
    }
    
    if (!botInstance) {
      console.error('❌ Bot instance not available in webhook handler');
      console.error('Available exports:', Object.keys(coreModule));
      console.error('Module default:', typeof coreModule.default);
      // Всегда возвращаем 200 для Telegram, чтобы не было повторных запросов
      return res.status(200).json({ ok: true, error: 'Bot not initialized' });
    }

    console.log('✅ Bot instance found');

    // Получаем raw body (Telegram отправляет JSON как raw body)
    // На Vercel с @vercel/node body может быть уже распарсен
    let update: any;
    
    // Проверяем, есть ли raw body в req
    if (req.body) {
      if (typeof req.body === 'string') {
        update = JSON.parse(req.body);
      } else if (Buffer.isBuffer(req.body)) {
        update = JSON.parse(req.body.toString());
      } else if (typeof req.body === 'object') {
        // Уже распарсен Vercel
        update = req.body;
      } else {
        update = req.body;
      }
    } else {
      // Если body пустой, возможно нужно читать из stream
      console.error('❌ No body in request');
      // Всегда возвращаем 200 для Telegram
      return res.status(200).json({ ok: true, error: 'No body' });
    }
    
    console.log('📨 Webhook received:', {
      updateId: update?.update_id,
      type: update?.message ? 'message' : update?.callback_query ? 'callback_query' : 'unknown',
    });

    // Обрабатываем обновление
    try {
      await botInstance.handleUpdate(update);
      console.log('✅ Update processed successfully');
    } catch (handleError: any) {
      console.error('❌ Error handling update:', handleError);
      console.error('Handle error stack:', handleError?.stack);
      // Продолжаем выполнение, чтобы вернуть 200
    }
    
    // Всегда возвращаем 200 OK для Telegram
    return res.status(200).json({ ok: true });
  } catch (error: any) {
    console.error('❌ Webhook error:', error);
    console.error('Error message:', error?.message);
    console.error('Error stack:', error?.stack);
    // Всегда возвращаем 200 для Telegram, чтобы не было повторных запросов
    return res.status(200).json({ ok: true, error: error?.message });
  }
}

