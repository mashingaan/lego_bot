import DOMPurify from 'isomorphic-dompurify';
import type { BotSchema } from '../types/bot-schema';

export function sanitizeHtml(input: string): string {
  return DOMPurify.sanitize(input, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}

export function sanitizeText(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeBotSchema(schema: BotSchema): BotSchema {
  const sanitizedStates: BotSchema['states'] = {};

  for (const [stateKey, state] of Object.entries(schema.states)) {
    sanitizedStates[stateKey] = {
      ...state,
      message: sanitizeText(state.message),
      buttons: state.buttons?.map((button) => ({
        ...button,
        text: sanitizeText(button.text),
      })),
    };
  }

  return {
    ...schema,
    states: sanitizedStates,
  };
}
