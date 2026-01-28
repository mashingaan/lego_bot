// Types
export * from './types/bot-schema-browser';
export * from './types/analytics';

// Constants
export * from './constants/limits-browser';

// Validation schemas (Zod - browser-safe)
// validateBotSchema is server-only and intentionally not exported here.
export * from './validation/schemas';

// Browser-safe utilities
export { sanitizeHtml, sanitizeText, sanitizeBotSchema } from './utils/sanitize';

// Shared interfaces
export interface User {
  id: number;
  telegramId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Bot {
  id: string;
  token: string;
  name: string;
  userId: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Dialogue {
  id: string;
  botId: string;
  name: string;
  nodes: DialogueNode[];
  edges: DialogueEdge[];
  createdAt: Date;
  updatedAt: Date;
}

export interface DialogueNode {
  id: string;
  type: 'message' | 'question' | 'condition' | 'action';
  data: Record<string, any>;
  position: { x: number; y: number };
}

export interface DialogueEdge {
  id: string;
  source: string;
  target: string;
  condition?: string;
}
