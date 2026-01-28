import { describe, expect, it } from 'vitest';
import { BOT_LIMITS } from '../../constants/limits';
import { validateBotSchema } from '../../validation/bot-schema-validation';

describe('validateBotSchema', () => {
  it('accepts a minimal valid schema', () => {
    const schema = {
      version: 1,
      initialState: 'start',
      states: {
        start: { message: 'Hello' },
      },
    };

    const result = validateBotSchema(schema);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts a full schema with buttons', () => {
    const schema = {
      version: 1,
      initialState: 'start',
      states: {
        start: {
          message: 'Start',
          buttons: [{ text: 'Next', nextState: 'next' }],
        },
        next: {
          message: 'Next',
        },
      },
    };

    const result = validateBotSchema(schema);
    expect(result.valid).toBe(true);
  });

  it('rejects missing version', () => {
    const result = validateBotSchema({
      initialState: 'start',
      states: { start: { message: 'Hello' } },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Schema version must be 1');
  });

  it('rejects invalid version', () => {
    const result = validateBotSchema({
      version: 2,
      initialState: 'start',
      states: { start: { message: 'Hello' } },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Schema version must be 1');
  });

  it('rejects missing states', () => {
    const result = validateBotSchema({
      version: 1,
      initialState: 'start',
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Schema states must be an object');
  });

  it('rejects missing initialState', () => {
    const result = validateBotSchema({
      version: 1,
      states: { start: { message: 'Hello' } },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Schema initialState must be a string');
  });

  it('rejects non-existent initialState', () => {
    const result = validateBotSchema({
      version: 1,
      initialState: 'missing',
      states: { start: { message: 'Hello' } },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Initial state does not exist in states');
  });

  it('rejects non-existent nextState', () => {
    const result = validateBotSchema({
      version: 1,
      initialState: 'start',
      states: {
        start: {
          message: 'Hello',
          buttons: [{ text: 'Next', nextState: 'missing' }],
        },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Button nextState "missing" does not exist in states');
  });

  it('rejects too many states', () => {
    const states: Record<string, { message: string }> = {};
    for (let i = 0; i < BOT_LIMITS.MAX_SCHEMA_STATES + 1; i += 1) {
      states[`state_${i}`] = { message: 'Hello' };
    }

    const result = validateBotSchema({
      version: 1,
      initialState: 'state_0',
      states,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      `Schema exceeds maximum states of ${BOT_LIMITS.MAX_SCHEMA_STATES}`
    );
  });

  it('rejects too many buttons', () => {
    const buttons = Array.from({ length: BOT_LIMITS.MAX_BUTTONS_PER_STATE + 1 }, (_, idx) => ({
      text: `Button ${idx}`,
      nextState: 'start',
    }));

    const result = validateBotSchema({
      version: 1,
      initialState: 'start',
      states: {
        start: {
          message: 'Hello',
          buttons,
        },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      `State "start" exceeds maximum buttons of ${BOT_LIMITS.MAX_BUTTONS_PER_STATE}`
    );
  });

  it('rejects long messages', () => {
    const longMessage = 'a'.repeat(BOT_LIMITS.MAX_MESSAGE_LENGTH + 1);
    const result = validateBotSchema({
      version: 1,
      initialState: 'start',
      states: {
        start: { message: longMessage },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      `State "start" message exceeds maximum length of ${BOT_LIMITS.MAX_MESSAGE_LENGTH}`
    );
  });

  it('rejects long button text', () => {
    const longText = 'b'.repeat(BOT_LIMITS.MAX_BUTTON_TEXT_LENGTH + 1);
    const result = validateBotSchema({
      version: 1,
      initialState: 'start',
      states: {
        start: {
          message: 'Hello',
          buttons: [{ text: longText, nextState: 'start' }],
        },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      `Button text exceeds maximum length of ${BOT_LIMITS.MAX_BUTTON_TEXT_LENGTH}`
    );
  });

  it('accepts schema with media types', () => {
    const schema = {
      version: 1,
      initialState: 'photo',
      states: {
        photo: {
          message: 'Photo',
          media: { type: 'photo', url: 'https://example.com/photo.jpg' },
        },
        video: {
          message: 'Video',
          media: { type: 'video', url: 'https://example.com/video.mp4', cover: 'https://example.com/cover.jpg' },
        },
        document: {
          message: 'Document',
          media: { type: 'document', url: 'https://example.com/doc.pdf' },
        },
        audio: {
          message: 'Audio',
          media: { type: 'audio', url: 'https://example.com/audio.mp3' },
        },
      },
    };

    const result = validateBotSchema(schema);
    expect(result.valid).toBe(true);
  });

  it('accepts media cover file_id', () => {
    const schema = {
      version: 1,
      initialState: 'video',
      states: {
        video: {
          message: 'Video',
          media: { type: 'video', url: 'https://example.com/video.mp4', cover: 'file_id_123' },
        },
      },
    };

    const result = validateBotSchema(schema);
    expect(result.valid).toBe(true);
  });

  it('accepts schema with mediaGroup', () => {
    const schema = {
      version: 1,
      initialState: 'gallery',
      states: {
        gallery: {
          message: 'Gallery',
          mediaGroup: [
            { type: 'photo', url: 'https://example.com/1.jpg', caption: 'One' },
            { type: 'photo', url: 'https://example.com/2.jpg', caption: 'Two' },
          ],
        },
      },
    };

    const result = validateBotSchema(schema);
    expect(result.valid).toBe(true);
  });

  it('accepts schema with url button', () => {
    const schema = {
      version: 1,
      initialState: 'start',
      states: {
        start: {
          message: 'Hello',
          buttons: [{ type: 'url', text: 'Open', url: 'https://example.com' }],
        },
      },
    };

    const result = validateBotSchema(schema);
    expect(result.valid).toBe(true);
  });

  it('rejects mixing inline and reply buttons', () => {
    const schema = {
      version: 1,
      initialState: 'start',
      states: {
        start: {
          message: 'Hello',
          buttons: [
            { text: 'Next', nextState: 'start' },
            { type: 'request_contact', text: 'Phone', nextState: 'start' },
          ],
        },
      },
    };

    const result = validateBotSchema(schema);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('State "start" cannot mix request and navigation buttons');
  });

  it('rejects invalid media url', () => {
    const schema = {
      version: 1,
      initialState: 'start',
      states: {
        start: {
          message: 'Hello',
          media: { type: 'photo', url: 'http://example.com/photo.jpg' },
        },
      },
    };

    const result = validateBotSchema(schema);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('State "start" media.url must be a valid HTTPS URL');
  });

  it('rejects media thumbnail without attach', () => {
    const schema = {
      version: 1,
      initialState: 'start',
      states: {
        start: {
          message: 'Hello',
          media: {
            type: 'video',
            url: 'https://example.com/video.mp4',
            thumbnail: 'https://example.com/thumb.jpg',
          },
        },
      },
    };

    const result = validateBotSchema(schema);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'State "start" media.thumbnail requires multipart/form-data (attach://...) in v1; use cover (URL) instead'
    );
  });

  it('rejects invalid mediaGroup size', () => {
    const tooSmall = {
      version: 1,
      initialState: 'gallery',
      states: {
        gallery: {
          message: 'Gallery',
          mediaGroup: [{ type: 'photo', url: 'https://example.com/1.jpg' }],
        },
      },
    };
    const tooLarge = {
      version: 1,
      initialState: 'gallery',
      states: {
        gallery: {
          message: 'Gallery',
          mediaGroup: Array.from({ length: 11 }, (_v, index) => ({
            type: 'photo',
            url: `https://example.com/${index}.jpg`,
          })),
        },
      },
    };

    const smallResult = validateBotSchema(tooSmall);
    const largeResult = validateBotSchema(tooLarge);
    expect(smallResult.valid).toBe(false);
    expect(largeResult.valid).toBe(false);
  });

  it('accepts parseMode values', () => {
    const htmlSchema = {
      version: 1,
      initialState: 'start',
      states: {
        start: {
          message: 'Hello',
          parseMode: 'HTML',
        },
      },
    };
    const markdownSchema = {
      version: 1,
      initialState: 'start',
      states: {
        start: {
          message: 'Hello',
          parseMode: 'Markdown',
        },
      },
    };
    const markdownV2Schema = {
      version: 1,
      initialState: 'start',
      states: {
        start: {
          message: 'Hello',
          parseMode: 'MarkdownV2',
        },
      },
    };

    expect(validateBotSchema(htmlSchema).valid).toBe(true);
    expect(validateBotSchema(markdownSchema).valid).toBe(true);
    expect(validateBotSchema(markdownV2Schema).valid).toBe(true);
  });

  it('rejects having media and mediaGroup together', () => {
    const schema = {
      version: 1,
      initialState: 'start',
      states: {
        start: {
          message: 'Hello',
          media: { type: 'photo', url: 'https://example.com/photo.jpg' },
          mediaGroup: [
            { type: 'photo', url: 'https://example.com/1.jpg' },
            { type: 'photo', url: 'https://example.com/2.jpg' },
          ],
        },
      },
    };

    const result = validateBotSchema(schema);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('State "start" cannot have both media and mediaGroup');
  });
});
