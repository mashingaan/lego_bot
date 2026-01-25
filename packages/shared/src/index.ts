// Shared types and utilities

export * from './logger';
export * from './middleware';
export * from './constants/limits';
export * from './types/bot-schema';
export * from './utils/circuit-breaker';
export * from './utils/graceful-degradation';
export * from './utils/sanitize';
export * from './utils/telegram-auth';
export * from './validation/schemas';

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

