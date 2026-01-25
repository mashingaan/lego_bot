import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import { WEBHOOK_LIMITS } from '@dialogue-constructor/shared';
import {
  botExistsByToken,
  createBot,
  deleteBot,
  getBotById,
  getBotByWebhookSecret,
  getBotsByUserId,
  setBotWebhookSecret,
  updateBotSchema,
  updateWebhookStatus,
} from '../bots';
import { getPostgresClient } from '../postgres';

vi.mock('../postgres', () => ({
  getPostgresClient: vi.fn(),
}));

describe('bots CRUD operations', () => {
  const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
  };
  const mockedGetPostgresClient = vi.mocked(getPostgresClient);

  beforeEach(() => {
    mockClient.query.mockReset();
    mockClient.release.mockReset();
    mockedGetPostgresClient.mockResolvedValue(mockClient as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createBot', () => {
    it('should create bot with valid data', async () => {
      const randomBuffer = Buffer.alloc(WEBHOOK_LIMITS.SECRET_TOKEN_LENGTH, 1);
      const randomBytesSpy = vi.spyOn(crypto, 'randomBytes').mockReturnValue(randomBuffer);
      const bot = {
        id: 'bot-1',
        user_id: 1,
        token: 'encrypted-token',
        name: 'Test Bot',
        webhook_set: false,
        schema: null,
        schema_version: 0,
        webhook_secret: randomBuffer.toString('hex'),
        created_at: new Date(),
        updated_at: new Date(),
      };
      mockClient.query.mockResolvedValue({ rows: [bot] });

      const result = await createBot({ user_id: 1, token: 'encrypted-token', name: 'Test Bot' });

      expect(result).toEqual(bot);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO bots'),
        [1, 'encrypted-token', 'Test Bot', randomBuffer.toString('hex')]
      );
      expect(mockClient.release).toHaveBeenCalled();
      randomBytesSpy.mockRestore();
    });
  });

  describe('getBotsByUserId', () => {
    it('should return bots for user', async () => {
      const bots = [
        { id: 'bot-1', user_id: 1, token: 't1', name: 'Bot 1' },
        { id: 'bot-2', user_id: 1, token: 't2', name: 'Bot 2' },
      ];
      mockClient.query.mockResolvedValue({ rows: bots });

      const result = await getBotsByUserId(1);

      expect(result).toEqual(bots);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
        [1]
      );
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('getBotById', () => {
    it('should return bot when found', async () => {
      const bot = { id: 'bot-1', user_id: 1, token: 't1', name: 'Bot 1' };
      mockClient.query.mockResolvedValue({ rows: [bot] });

      const result = await getBotById('bot-1', 1);

      expect(result).toEqual(bot);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1 AND user_id = $2'),
        ['bot-1', 1]
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should return null when not found', async () => {
      mockClient.query.mockResolvedValue({ rows: [] });

      const result = await getBotById('missing', 1);

      expect(result).toBeNull();
    });
  });

  describe('botExistsByToken', () => {
    it('should return true when token exists', async () => {
      mockClient.query.mockResolvedValue({ rows: [{ exists: true }] });

      const result = await botExistsByToken('token');

      expect(result).toBe(true);
    });

    it('should return false when token missing', async () => {
      mockClient.query.mockResolvedValue({ rows: [] });

      const result = await botExistsByToken('token');

      expect(result).toBe(false);
    });
  });

  describe('getBotByWebhookSecret', () => {
    it('should return bot when secret matches', async () => {
      const bot = { id: 'bot-1', webhook_secret: 'secret' };
      mockClient.query.mockResolvedValue({ rows: [bot] });

      const result = await getBotByWebhookSecret('secret');

      expect(result).toEqual(bot);
    });

    it('should return null when secret missing', async () => {
      mockClient.query.mockResolvedValue({ rows: [] });

      const result = await getBotByWebhookSecret('missing');

      expect(result).toBeNull();
    });
  });

  describe('setBotWebhookSecret', () => {
    it('should update webhook secret', async () => {
      mockClient.query.mockResolvedValue({ rowCount: 1 });

      const result = await setBotWebhookSecret('bot-1', 1, 'secret');

      expect(result).toBe(true);
    });

    it('should return false when no rows updated', async () => {
      mockClient.query.mockResolvedValue({ rowCount: 0 });

      const result = await setBotWebhookSecret('bot-1', 1, 'secret');

      expect(result).toBe(false);
    });
  });

  describe('deleteBot', () => {
    it('should delete bot', async () => {
      mockClient.query.mockResolvedValue({ rowCount: 1 });

      const result = await deleteBot('bot-1', 1);

      expect(result).toBe(true);
    });

    it('should return false when bot not found', async () => {
      mockClient.query.mockResolvedValue({ rowCount: 0 });

      const result = await deleteBot('missing', 1);

      expect(result).toBe(false);
    });
  });

  describe('updateWebhookStatus', () => {
    it('should update webhook_set flag', async () => {
      mockClient.query.mockResolvedValue({ rowCount: 1 });

      const result = await updateWebhookStatus('bot-1', 1, true);

      expect(result).toBe(true);
    });
  });

  describe('updateBotSchema', () => {
    it('should update schema and increment version', async () => {
      const schema = { version: 1, states: { start: { message: 'Hi' } }, initialState: 'start' };
      mockClient.query.mockResolvedValue({ rowCount: 1 });

      const result = await updateBotSchema('bot-1', 1, schema as any);

      expect(result).toBe(true);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('schema_version = schema_version + 1'),
        [JSON.stringify(schema), 'bot-1', 1]
      );
    });
  });
});
