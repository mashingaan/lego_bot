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
import { BotSummary, ApiError, BotUser, AnalyticsEvent, AnalyticsStats, PopularPath, FunnelStep, TimeSeriesData, Broadcast, BroadcastStats, CreateBroadcastData } from '../types';
import { BotSchema } from '@dialogue-constructor/shared/browser';

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

function getInitData(): string | null {
  return window.Telegram?.WebApp?.initData || null;
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
  const initData = getInitData();
  
  if (!userId) {
    console.error('❌ User ID not found');
    throw new Error('User ID not found. Make sure you are running in Telegram WebApp.');
  }
  if (!initData) {
    console.error('❌ Telegram initData not found');
    throw new Error('Telegram initData not found. Make sure you are running in Telegram WebApp.');
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
        'X-Telegram-Init-Data': initData,
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
      const message = errorData.error || errorData.message || `API request failed: ${response.status} ${response.statusText}`;
      const requestError = new Error(message);
      (requestError as any).status = response.status;
      (requestError as any).data = errorData;
      throw requestError;
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
  getBots: (params?: { limit?: number; offset?: number }): Promise<{ bots: BotSummary[]; pagination: { total: number; limit: number; offset: number; hasMore: boolean } }> => {
    const query = new URLSearchParams();
    if (params?.limit !== undefined) {
      query.set('limit', String(params.limit));
    }
    if (params?.offset !== undefined) {
      query.set('offset', String(params.offset));
    }

    const suffix = query.toString();
    const endpoint = suffix ? `/api/bots?${suffix}` : '/api/bots';
    return apiRequest<{ bots: BotSummary[]; pagination: { total: number; limit: number; offset: number; hasMore: boolean } }>(endpoint);
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

  createBot: async (name: string, schema?: BotSchema): Promise<{ id: string; name: string; webhook_set: boolean; schema_version: number; created_at: string }> => {
    const userId = getUserId();
    const token = generatePlaceholderToken(userId);
    const bot = await apiRequest<{ id: string; name: string; webhook_set: boolean; schema_version: number; created_at: string }>(
      '/api/bots',
      {
        method: 'POST',
        body: JSON.stringify({ name, token }),
      }
    );

    if (schema) {
      await api.updateBotSchema(bot.id, schema);
    }

    return bot;
  },

  getBotUsers: async (
    botId: string,
    params?: { limit?: number; cursor?: string }
  ): Promise<{ users: BotUser[]; nextCursor: string | null; hasMore: boolean }> => {
    try {
      const query = new URLSearchParams();
      if (params?.limit !== undefined) {
        query.set('limit', String(params.limit));
      }
      if (params?.cursor) {
        query.set('cursor', params.cursor);
      }
      const suffix = query.toString();
      const endpoint = suffix ? `/api/bot/${botId}/users?${suffix}` : `/api/bot/${botId}/users`;
      return await apiRequest<{ users: BotUser[]; nextCursor: string | null; hasMore: boolean }>(endpoint);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось загрузить контакты';
      window.Telegram?.WebApp?.showAlert?.(message);
      throw error;
    }
  },

  getBotUserStats: async (
    botId: string
  ): Promise<{ total: number; newLast7Days: number; conversionRate: number }> => {
    try {
      return await apiRequest<{ total: number; newLast7Days: number; conversionRate: number }>(
        `/api/bot/${botId}/users/stats`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось загрузить статистику';
      window.Telegram?.WebApp?.showAlert?.(message);
      throw error;
    }
  },

  getWebhookLogs: async (
    botId: string,
    params?: { limit?: number; cursor?: string }
  ): Promise<{ logs: any[]; nextCursor: string | null; hasMore: boolean }> => {
    const query = new URLSearchParams();
    if (params?.limit !== undefined) {
      query.set('limit', String(params.limit));
    }
    if (params?.cursor) {
      query.set('cursor', params.cursor);
    }
    const suffix = query.toString();
    const endpoint = suffix
      ? `/api/bot/${botId}/webhooks?${suffix}`
      : `/api/bot/${botId}/webhooks`;
    return apiRequest<{ logs: any[]; nextCursor: string | null; hasMore: boolean }>(endpoint);
  },

  getWebhookStats: async (
    botId: string
  ): Promise<{ total: number; successRate: number; states: any[] }> => {
    return apiRequest<{ total: number; successRate: number; states: any[] }>(
      `/api/bot/${botId}/webhooks/stats`
    );
  },

  testWebhook: async (
    botId: string,
    stateKey: string
  ): Promise<{ success: boolean; status: number; response: any }> => {
    return apiRequest<{ success: boolean; status: number; response: any }>(
      `/api/bot/${botId}/test-webhook`,
      {
        method: 'POST',
        body: JSON.stringify({ stateKey }),
      }
    );
  },

  getAnalyticsEvents: async (
    botId: string,
    params?: { limit?: number; cursor?: string; eventType?: string; dateFrom?: string; dateTo?: string }
  ): Promise<{ events: AnalyticsEvent[]; nextCursor: string | null; hasMore: boolean }> => {
    const query = new URLSearchParams();
    if (params?.limit !== undefined) {
      query.set('limit', String(params.limit));
    }
    if (params?.cursor) {
      query.set('cursor', params.cursor);
    }
    if (params?.eventType) {
      query.set('event_type', params.eventType);
    }
    if (params?.dateFrom) {
      query.set('date_from', params.dateFrom);
    }
    if (params?.dateTo) {
      query.set('date_to', params.dateTo);
    }
    const suffix = query.toString();
    const endpoint = suffix
      ? `/api/bot/${botId}/analytics/events?${suffix}`
      : `/api/bot/${botId}/analytics/events`;
    return apiRequest<{ events: AnalyticsEvent[]; nextCursor: string | null; hasMore: boolean }>(endpoint);
  },

  getAnalyticsStats: async (
    botId: string,
    dateFrom?: string,
    dateTo?: string
  ): Promise<AnalyticsStats> => {
    const query = new URLSearchParams();
    if (dateFrom) {
      query.set('date_from', dateFrom);
    }
    if (dateTo) {
      query.set('date_to', dateTo);
    }
    const suffix = query.toString();
    const endpoint = suffix
      ? `/api/bot/${botId}/analytics/stats?${suffix}`
      : `/api/bot/${botId}/analytics/stats`;
    return apiRequest<AnalyticsStats>(endpoint);
  },

  getPopularPaths: async (
    botId: string,
    limit?: number,
    dateFrom?: string,
    dateTo?: string
  ): Promise<{ paths: PopularPath[] }> => {
    const query = new URLSearchParams();
    if (limit !== undefined) {
      query.set('limit', String(limit));
    }
    if (dateFrom) {
      query.set('date_from', dateFrom);
    }
    if (dateTo) {
      query.set('date_to', dateTo);
    }
    const suffix = query.toString();
    const endpoint = suffix
      ? `/api/bot/${botId}/analytics/paths?${suffix}`
      : `/api/bot/${botId}/analytics/paths`;
    return apiRequest<{ paths: PopularPath[] }>(endpoint);
  },

  getFunnelData: async (
    botId: string,
    states: string[],
    dateFrom?: string,
    dateTo?: string
  ): Promise<{ steps: FunnelStep[] }> => {
    const query = new URLSearchParams();
    query.set('states', states.join(','));
    if (dateFrom) {
      query.set('date_from', dateFrom);
    }
    if (dateTo) {
      query.set('date_to', dateTo);
    }
    return apiRequest<{ steps: FunnelStep[] }>(
      `/api/bot/${botId}/analytics/funnel?${query.toString()}`
    );
  },

  getTimeSeriesData: async (
    botId: string,
    eventType: string,
    dateFrom?: string,
    dateTo?: string,
    granularity?: string
  ): Promise<{ data: TimeSeriesData[] }> => {
    const query = new URLSearchParams();
    query.set('event_type', eventType);
    if (dateFrom) {
      query.set('date_from', dateFrom);
    }
    if (dateTo) {
      query.set('date_to', dateTo);
    }
    if (granularity) {
      query.set('granularity', granularity);
    }
    return apiRequest<{ data: TimeSeriesData[] }>(
      `/api/bot/${botId}/analytics/timeseries?${query.toString()}`
    );
  },

  createBroadcast: async (botId: string, data: CreateBroadcastData): Promise<Broadcast> => {
    return apiRequest<Broadcast>(`/api/bot/${botId}/broadcasts`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  getBroadcasts: async (
    botId: string,
    params?: { limit?: number; cursor?: string }
  ): Promise<{ broadcasts: Broadcast[]; nextCursor: string | null; hasMore: boolean }> => {
    const query = new URLSearchParams();
    if (params?.limit !== undefined) {
      query.set('limit', String(params.limit));
    }
    if (params?.cursor) {
      query.set('cursor', params.cursor);
    }
    const suffix = query.toString();
    const endpoint = suffix
      ? `/api/bot/${botId}/broadcasts?${suffix}`
      : `/api/bot/${botId}/broadcasts`;
    return apiRequest<{ broadcasts: Broadcast[]; nextCursor: string | null; hasMore: boolean }>(endpoint);
  },

  getBroadcastDetails: async (
    botId: string,
    broadcastId: string
  ): Promise<Broadcast & { stats: BroadcastStats }> => {
    return apiRequest<Broadcast & { stats: BroadcastStats }>(
      `/api/bot/${botId}/broadcasts/${broadcastId}`
    );
  },

  startBroadcast: async (
    botId: string,
    broadcastId: string
  ): Promise<{ success: boolean }> => {
    return apiRequest<{ success: boolean }>(
      `/api/bot/${botId}/broadcasts/${broadcastId}/start`,
      { method: 'POST' }
    );
  },

  cancelBroadcast: async (
    botId: string,
    broadcastId: string
  ): Promise<{ success: boolean }> => {
    return apiRequest<{ success: boolean }>(
      `/api/bot/${botId}/broadcasts/${broadcastId}/cancel`,
      { method: 'POST' }
    );
  },

  exportAnalytics: async (botId: string, dateFrom?: string, dateTo?: string): Promise<Blob> => {
    const userId = getUserId();
    const initData = getInitData();
    if (!userId) {
      throw new Error('User ID not found. Make sure you are running in Telegram WebApp.');
    }
    if (!initData) {
      throw new Error('Telegram initData not found. Make sure you are running in Telegram WebApp.');
    }

    const apiUrl = getApiUrl();
    const query = new URLSearchParams();
    query.set('user_id', String(userId));
    if (dateFrom) {
      query.set('date_from', dateFrom);
    }
    if (dateTo) {
      query.set('date_to', dateTo);
    }
    const url = `${apiUrl}/api/bot/${botId}/analytics/export?${query.toString()}`;
    try {
      const response = await fetch(url, {
        headers: {
          'X-Telegram-Init-Data': initData,
        },
      });

      if (!response.ok) {
        let errorData: ApiError | null = null;
        try {
          errorData = await response.json();
        } catch {
          errorData = null;
        }
        const message =
          errorData?.error ||
          errorData?.message ||
          `API request failed: ${response.status} ${response.statusText}`;
        throw new Error(message);
      }

      return await response.blob();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось экспортировать отчёт';
      window.Telegram?.WebApp?.showAlert?.(message);
      throw error;
    }
  },

  exportBotUsers: async (botId: string): Promise<Blob> => {
    const userId = getUserId();
    const initData = getInitData();
    if (!userId) {
      throw new Error('User ID not found. Make sure you are running in Telegram WebApp.');
    }
    if (!initData) {
      throw new Error('Telegram initData not found. Make sure you are running in Telegram WebApp.');
    }

    const apiUrl = getApiUrl();
    const url = `${apiUrl}/api/bot/${botId}/users/export?user_id=${userId}`;
    try {
      const response = await fetch(url, {
        headers: {
          'X-Telegram-Init-Data': initData,
        },
      });

      if (!response.ok) {
        let errorData: ApiError | null = null;
        try {
          errorData = await response.json();
        } catch {
          errorData = null;
        }
        const message =
          errorData?.error ||
          errorData?.message ||
          `API request failed: ${response.status} ${response.statusText}`;
        throw new Error(message);
      }

      return await response.blob();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось экспортировать контакты';
      window.Telegram?.WebApp?.showAlert?.(message);
      throw error;
    }
  },
};

function generatePlaceholderToken(userId: number | null): string {
  const prefix = userId && Number.isFinite(userId) ? String(userId) : String(Date.now());
  return `${prefix}:${generateTokenSuffix(35)}`;
}

function generateTokenSuffix(length: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  const values = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(values);
  } else {
    for (let i = 0; i < length; i += 1) {
      values[i] = Math.floor(Math.random() * 256);
    }
  }

  let result = '';
  for (let i = 0; i < length; i += 1) {
    result += alphabet[values[i] % alphabet.length];
  }
  return result;
}

