/**
 * API Client for Mini-App
 * 
 * Environment Detection:
 * - Local: http://localhost:3000 (when mini-app runs on localhost:5174)
 * - Production: https://lego-bot-core.vercel.app (when deployed)
 * 
 * Testing:
 * 1. Start core: cd packages/core && npm run dev
 * 2. Start mini-app: cd packages/mini-app && npm run dev
 * 3. Open http://localhost:5174 in browser
 * 4. Check console for "🏠 Local development detected"
 * 5. Verify API calls go to http://localhost:3000
 * 
 * Manual API Testing:
 * - GET /api/bots: curl "http://localhost:3000/api/bots?user_id=123"
 * - GET /api/bot/:id/schema: curl "http://localhost:3000/api/bot/BOT_ID/schema?user_id=123"
 * - POST /api/bot/:id/schema: curl -X POST "http://localhost:3000/api/bot/BOT_ID/schema?user_id=123" \
 *     -H "Content-Type: application/json" \
 *     -d '{"version":1,"initialState":"start","states":{"start":{"message":"Test"}}}'
 */
import { Bot, ApiError } from '../types';
import { BotSchema } from '@dialogue-constructor/shared';

function getApiUrl(): string {
  const hostname =
    typeof window !== 'undefined' ? window.location.hostname : '';

  const isLocalhost =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0.0.0.0';

  const isDev = import.meta.env.DEV;

  if (isLocalhost || isDev) {
    const localUrl =
      import.meta.env.VITE_API_URL_LOCAL || 'http://localhost:3000';
    console.log('🏠 Local dev detected, using:', localUrl);
    return localUrl;
  }

  const prodUrl =
    import.meta.env.VITE_API_URL || 'https://lego-bot-core.vercel.app';
  console.log('🌐 Production mode, using:', prodUrl);
  return prodUrl;
}

// Получить user_id из Telegram WebApp
function getUserId(): number | null {
  // Проверяем, что мы в Telegram WebApp
  if (!window.Telegram?.WebApp) {
    return null;
  }
  
  const initData = window.Telegram.WebApp.initDataUnsafe;
  return initData?.user?.id || null;
}

// Проверка, что приложение запущено в Telegram
export function isTelegramWebApp(): boolean {
  return typeof window !== 'undefined' && !!window.Telegram?.WebApp;
}

async function apiRequest<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const userId = getUserId();
  
  if (!userId) {
    console.error('❌ User ID not found');
    throw new Error('User ID not found. Make sure you are running in Telegram WebApp.');
  }

  const apiUrl = getApiUrl();
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'unknown';
  const url = `${apiUrl}${endpoint}${endpoint.includes('?') ? '&' : '?'}user_id=${userId}`;
  
  console.log('📡 API Request:', {
    method: options?.method || 'GET',
    url,
    userId,
    apiUrl,
    isLocalhost: hostname,
  });

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    console.log('📥 API Response:', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
    });

    console.log('📥 Response:', {
      url: response.url,
      status: response.status,
      type: response.type,
      redirected: response.redirected,
      contentType: response.headers.get('content-type'),
    });

    if (!response.ok) {
      let errorData: ApiError;
      try {
        errorData = await response.json();
      } catch {
        errorData = {
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }
      
      console.error('❌ API Error:', errorData);
      console.error('❌ Response details:', {
        url: response.url,
        redirected: response.redirected,
        type: response.type,
      });
      throw new Error(errorData.error || errorData.message || `API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('✅ API Success:', data);
    return data;
  } catch (error) {
    console.error('❌ Request failed:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      apiUrl,
      endpoint,
    });
    console.error('❌ API Request Error:', error);
    throw error;
  }
}

export const api = {
  // Получить список ботов
  getBots: (): Promise<Bot[]> => {
    return apiRequest<Bot[]>('/api/bots');
  },

  // Получить схему бота
  getBotSchema: (botId: string): Promise<{ schema: BotSchema; schema_version: number }> => {
    return apiRequest(`/api/bot/${botId}/schema`);
  },

  // Обновить схему бота
  updateBotSchema: (botId: string, schema: BotSchema): Promise<{ success: boolean; message: string; schema_version: number }> => {
    return apiRequest(`/api/bot/${botId}/schema`, {
      method: 'POST',
      body: JSON.stringify(schema),
    });
  },
};

