import type { BotSchema } from '../types/bot-schema';

export type MockBot = {
  id: string;
  user_id: number;
  token: string;
  name: string;
  webhook_set: boolean;
  webhook_secret: string | null;
  schema: BotSchema | null;
  schema_version: number;
  created_at: Date;
  updated_at: Date;
};

export function createMockBotSchema(overrides: Partial<BotSchema> = {}): BotSchema {
  return {
    version: 1,
    initialState: 'start',
    states: {
      start: {
        message: 'Hello',
        buttons: [{ text: 'Next', nextState: 'next' }],
      },
      next: {
        message: 'Next step',
      },
    },
    ...overrides,
  };
}

export function createMockBot(overrides: Partial<MockBot> = {}): MockBot {
  const now = new Date();
  return {
    id: 'bot-1',
    user_id: 1,
    token: 'encrypted-token',
    name: 'Test Bot',
    webhook_set: false,
    webhook_secret: 'webhook-secret',
    schema: createMockBotSchema(),
    schema_version: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

export function createMockTelegramUpdate(overrides: Record<string, unknown> = {}) {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 1, type: 'private' },
      from: { id: 1, is_bot: false, first_name: 'Test' },
      text: 'Hello',
    },
    ...overrides,
  };
}
