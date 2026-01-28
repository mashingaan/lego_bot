export interface AnalyticsEvent {
  id: string;
  bot_id: string;
  telegram_user_id: string;
  source_update_id: string;
  event_type: string;
  state_from: string | null;
  state_to: string | null;
  button_text: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

export interface AnalyticsStats {
  totalUsers: number;
  totalEvents: number;
  uniqueUsers: number;
  avgActiveSpan: number;
}

export interface PopularPath {
  stateFrom: string | null;
  stateTo: string | null;
  count: number;
  percentage: number;
}

export interface FunnelStep {
  stateName: string;
  usersEntered: number;
  usersExited: number;
  conversionRate: number;
}

export interface TimeSeriesData {
  date: string;
  count: number;
}

export type AnalyticsEventsParams = {
  limit: number;
  cursor?: string;
  eventType?: string;
  dateFrom?: string;
  dateTo?: string;
};

export type AnalyticsEventData = {
  stateFrom?: string | null;
  stateTo?: string | null;
  buttonText?: string | null;
  metadata?: Record<string, unknown> | null;
};
