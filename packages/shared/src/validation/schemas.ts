import { z } from 'zod';
import { sanitizeText } from '../utils/sanitize';

export const CreateBotSchema = z.object({
  token: z.string().regex(/^\d+:[A-Za-z0-9_-]{35}$/),
  name: z.string().min(1).max(100).transform(sanitizeText),
});

const ButtonSchema = z.object({
  text: z.string().transform(sanitizeText),
  nextState: z.string(),
});

const StateSchema = z.object({
  message: z.string().transform(sanitizeText),
  buttons: z.array(ButtonSchema).optional(),
});

export const UpdateBotSchemaSchema = z.object({
  version: z.literal(1),
  states: z.record(StateSchema),
  initialState: z.string(),
});

export const BotIdSchema = z.string().uuid();

export const UserIdSchema = z.number().int().positive();

export const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export const TelegramUpdateSchema = z.object({
  update_id: z.number(),
  message: z
    .object({
      message_id: z.number(),
      from: z
        .object({
          id: z.number(),
        })
        .optional(),
      chat: z.object({
        id: z.number(),
      }),
      text: z.string().optional(),
    })
    .optional(),
  callback_query: z
    .object({
      id: z.string(),
      from: z.object({
        id: z.number(),
      }),
      message: z
        .object({
          message_id: z.number(),
          chat: z.object({
            id: z.number(),
          }),
        })
        .optional(),
      data: z.string(),
    })
    .optional(),
}).passthrough();
