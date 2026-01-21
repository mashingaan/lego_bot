import { BotSchema } from '@dialogue-constructor/shared';

export interface Bot {
  id: string;
  name: string;
  webhook_set: boolean;
  schema_version: number;
  created_at: string;
}

export interface BotWithSchema extends Bot {
  schema: BotSchema | null;
}

export interface ApiError {
  error: string;
  message?: string;
}


