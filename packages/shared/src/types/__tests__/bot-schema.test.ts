import { describe, expect, it } from 'vitest';
import { BOT_LIMITS } from '../../constants/limits';
import { validateBotSchema } from '../bot-schema';

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
});
