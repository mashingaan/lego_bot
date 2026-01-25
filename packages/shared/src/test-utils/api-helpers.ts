import express from 'express';
import type { Express } from 'express';
import type { Test } from 'supertest';
import { expect } from 'vitest';
import crypto from 'crypto';

export function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  return app;
}

export function buildTelegramInitData(userId: number, botToken: string): string {
  const params = new URLSearchParams();
  params.set('auth_date', Math.floor(Date.now() / 1000).toString());
  params.set('user', JSON.stringify({ id: userId, first_name: 'Test' }));

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);

  return params.toString();
}

export function authenticateRequest(request: Test, userId = 1, botToken?: string): Test {
  const token = botToken ?? process.env.BOT_TOKEN ?? 'test-bot-token';
  const initData = buildTelegramInitData(userId, token);
  return request.set('X-Telegram-Init-Data', initData);
}

export function expectApiError(response: { status: number; body: any }, status: number, error?: string) {
  expect(response.status).toBe(status);
  if (error) {
    expect(response.body.error).toBe(error);
  }
}
