import { Bot, BotWithSchema, ApiError } from '../types';
import { BotSchema } from '@dialogue-constructor/shared';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Получить user_id из Telegram WebApp
function getUserId(): number | null {
  const initData = window.Telegram?.WebApp?.initDataUnsafe;
  return initData?.user?.id || null;
}

async function apiRequest<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const userId = getUserId();
  
  if (!userId) {
    throw new Error('User ID not found. Make sure you are running in Telegram WebApp.');
  }

  const url = `${API_URL}${endpoint}${endpoint.includes('?') ? '&' : '?'}user_id=${userId}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error: ApiError = await response.json().catch(() => ({
      error: `HTTP ${response.status}: ${response.statusText}`,
    }));
    throw new Error(error.error || error.message || 'API request failed');
  }

  return response.json();
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

