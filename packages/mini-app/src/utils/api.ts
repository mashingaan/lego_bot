import { Bot, ApiError } from '../types';
import { BotSchema } from '@dialogue-constructor/shared';

// API URL для Mini App - должен быть установлен в переменных окружения Vercel
// Для production используем production URL core сервиса
const API_URL = import.meta.env.VITE_API_URL || 'https://lego-bot-core.vercel.app';

console.log('🔗 API URL:', API_URL);

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

  const url = `${API_URL}${endpoint}${endpoint.includes('?') ? '&' : '?'}user_id=${userId}`;
  
  console.log('📡 API Request:', {
    method: options?.method || 'GET',
    url,
    userId,
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
      throw new Error(errorData.error || errorData.message || `API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('✅ API Success:', data);
    return data;
  } catch (error) {
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

