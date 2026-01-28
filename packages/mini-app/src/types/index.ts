import {
  BotSchema,
  BotButton,
  UrlButton,
  AnalyticsEvent,
  AnalyticsStats,
  PopularPath,
  FunnelStep,
  TimeSeriesData,
  MediaContent,
} from '@dialogue-constructor/shared/browser';

export interface Bot {
  id: string;
  name: string;
  webhook_set: boolean;
  schema_version: number;
  created_at: string;
}

export type BotSummary = Bot;

export interface BotWithSchema extends Bot {
  schema: BotSchema | null;
}

export interface ApiError {
  error: string;
  message?: string;
}

export interface BotUser {
  id: string;
  bot_id: string;
  telegram_user_id: string;
  first_name: string;
  last_name?: string;
  username?: string;
  phone_number?: string;
  email?: string;
  language_code?: string;
  first_interaction_at: string;
  last_interaction_at: string;
  interaction_count: number;
}

export interface Broadcast {
  id: string;
  bot_id: string;
  name: string;
  message: string;
  media?: MediaContent;
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  status: 'draft' | 'scheduled' | 'processing' | 'completed' | 'failed' | 'cancelled';
  scheduled_at?: string;
  started_at?: string;
  completed_at?: string;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
  updated_at: string;
}

export interface BroadcastStats {
  total: number;
  pending: number;
  sending: number;
  sent: number;
  failed: number;
  clicks: number;
  engaged: number;
  progress: number;
}

export interface CreateBroadcastData {
  name: string;
  message: string;
  media?: MediaContent;
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  scheduledAt?: string;
}

export type { BotSchema, BotButton, UrlButton, AnalyticsEvent, AnalyticsStats, PopularPath, FunnelStep, TimeSeriesData, MediaContent };


