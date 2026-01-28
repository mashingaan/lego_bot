import axios from 'axios';
import { sanitizeHtml } from '@dialogue-constructor/shared';
import type { Logger } from '@dialogue-constructor/shared';

const TELEGRAM_API_BASE_URL = 'https://api.telegram.org/bot';

const escapeMarkdownV2 = (text: string) =>
  text.replace(/([\\_*[\]()~`>#+\-=|{}.!])/g, '\\$1');

const normalizeText = (text: string, parseMode: 'HTML' | 'Markdown' | 'MarkdownV2') => {
  if (parseMode === 'HTML') {
    return sanitizeHtml(text);
  }
  if (parseMode === 'MarkdownV2') {
    return escapeMarkdownV2(text);
  }
  return text;
};

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      is_bot?: boolean;
      first_name?: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
    chat: {
      id: number;
      type?: string;
    };
    text?: string;
    contact?: {
      phone_number: string;
      first_name: string;
      last_name?: string;
      user_id?: number;
    };
    reply_to_message?: {
      message_id: number;
    };
  };
  callback_query?: {
    id: string;
    from: {
      id: number;
      is_bot?: boolean;
      first_name?: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
    message?: {
      message_id: number;
      chat: {
        id: number;
      };
    };
    data: string;
  };
  edited_message?: any;
}

/**
 * Отправка сообщения через Telegram Bot API
 */
export async function sendTelegramMessage(
  logger: Logger,
  botToken: string,
  chatId: number,
  text: string,
  parseMode: 'HTML' | 'Markdown' | 'MarkdownV2' = 'HTML'
): Promise<void> {
  const startTime = Date.now();
  const sanitizedText = normalizeText(text, parseMode);
  const parseModeToSend = parseMode;
  logger.debug({ chatId, textLength: sanitizedText.length }, 'Sending Telegram message');
  try {
    const url = `${TELEGRAM_API_BASE_URL}${botToken}/sendMessage`;
    
    const response = await axios.post(url, {
      chat_id: chatId,
      text: sanitizedText,
      parse_mode: parseModeToSend,
    }, {
      timeout: 10000,
    });

    if (!response.data.ok) {
      throw new Error(`Telegram API error: ${response.data.description}`);
    }

    logger.info(
      { chatId, messageId: response.data?.result?.message_id, duration: Date.now() - startTime },
      'Telegram message sent'
    );
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error(
        { chatId, error: error.message, statusCode: error.response?.status },
        'Telegram API error'
      );
      const errorMessage = error.response?.data?.description || error.message;
      throw new Error(`Failed to send Telegram message: ${errorMessage}`);
    }
    logger.error(
      { chatId, error: error instanceof Error ? error.message : String(error) },
      'Telegram API error'
    );
    throw error;
  }
}

/**
 * Отправить сообщение с inline клавиатурой
 */
export async function sendTelegramMessageWithKeyboard(
  logger: Logger,
  botToken: string,
  chatId: number,
  text: string,
  buttons: Array<{ text: string; nextState?: string; url?: string }>,
  parseMode: 'HTML' | 'Markdown' | 'MarkdownV2' = 'HTML'
): Promise<any> {
  const startTime = Date.now();
  const sanitizedText = normalizeText(text, parseMode);
  const parseModeToSend = parseMode;
  logger.debug({ chatId, textLength: sanitizedText.length }, 'Sending Telegram message');
  const url = `${TELEGRAM_API_BASE_URL}${botToken}/sendMessage`;
  
  // Преобразуем кнопки в формат Telegram InlineKeyboardMarkup
  // Группируем по 2 кнопки в ряд
  const keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>> = [];
  for (let i = 0; i < buttons.length; i += 2) {
    const row = buttons.slice(i, i + 2).map((btn) =>
      btn.url ? { text: btn.text, url: btn.url } : { text: btn.text, callback_data: btn.nextState ?? '' }
    );
    keyboard.push(row);
  }

  try {
    const response = await axios.post(url, {
      chat_id: chatId,
      text: sanitizedText,
      parse_mode: parseModeToSend,
      reply_markup: {
        inline_keyboard: keyboard,
      },
    }, {
      timeout: 10000,
    });

    if (!response.data.ok) {
      throw new Error(`Telegram API error: ${response.data.description}`);
    }

    logger.info(
      { chatId, messageId: response.data?.result?.message_id, duration: Date.now() - startTime },
      'Telegram message sent'
    );
    
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error(
        { chatId, error: error.message, statusCode: error.response?.status },
        'Telegram API error'
      );
      const errorMessage = error.response?.data?.description || error.message;
      throw new Error(`Failed to send Telegram message with keyboard: ${errorMessage}`);
    }
    logger.error(
      { chatId, error: error instanceof Error ? error.message : String(error) },
      'Telegram API error'
    );
    throw error;
  }
}

/**
 * Отправить сообщение с ReplyKeyboardMarkup (request_contact)
 */
export async function sendTelegramMessageWithReplyKeyboard(
  logger: Logger,
  botToken: string,
  chatId: number,
  text: string,
  buttons: Array<{ text: string; nextState: string }>,
  parseMode: 'HTML' | 'Markdown' | 'MarkdownV2' = 'HTML'
): Promise<any> {
  const startTime = Date.now();
  const sanitizedText = normalizeText(text, parseMode);
  const parseModeToSend = parseMode;
  logger.debug({ chatId, textLength: sanitizedText.length }, 'Sending Telegram message');
  const url = `${TELEGRAM_API_BASE_URL}${botToken}/sendMessage`;

  const keyboard = buttons.map((button) => [
    {
      text: button.text,
      request_contact: true,
    },
  ]);

  try {
    const response = await axios.post(
      url,
      {
        chat_id: chatId,
        text: sanitizedText,
        parse_mode: parseModeToSend,
        reply_markup: {
          keyboard,
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      },
      {
        timeout: 10000,
      }
    );

    if (!response.data.ok) {
      throw new Error(`Telegram API error: ${response.data.description}`);
    }

    logger.info(
      { chatId, messageId: response.data?.result?.message_id, duration: Date.now() - startTime },
      'Telegram message sent'
    );

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error(
        { chatId, error: error.message, statusCode: error.response?.status },
        'Telegram API error'
      );
      const errorMessage = error.response?.data?.description || error.message;
      throw new Error(`Failed to send Telegram message with reply keyboard: ${errorMessage}`);
    }
    logger.error(
      { chatId, error: error instanceof Error ? error.message : String(error) },
      'Telegram API error'
    );
    throw error;
  }
}

export async function sendTelegramMessageWithReplyKeyboardRemove(
  logger: Logger,
  botToken: string,
  chatId: number,
  text: string,
  parseMode: 'HTML' | 'Markdown' | 'MarkdownV2' = 'HTML'
): Promise<any> {
  const startTime = Date.now();
  const sanitizedText = normalizeText(text, parseMode);
  const parseModeToSend = parseMode;
  logger.debug({ chatId, textLength: sanitizedText.length }, 'Sending Telegram message');
  const url = `${TELEGRAM_API_BASE_URL}${botToken}/sendMessage`;

  try {
    const response = await axios.post(
      url,
      {
        chat_id: chatId,
        text: sanitizedText,
        parse_mode: parseModeToSend,
        reply_markup: {
          remove_keyboard: true,
        },
      },
      {
        timeout: 10000,
      }
    );

    if (!response.data.ok) {
      throw new Error(`Telegram API error: ${response.data.description}`);
    }

    logger.info(
      { chatId, messageId: response.data?.result?.message_id, duration: Date.now() - startTime },
      'Telegram message sent'
    );

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error(
        { chatId, error: error.message, statusCode: error.response?.status },
        'Telegram API error'
      );
      const errorMessage = error.response?.data?.description || error.message;
      throw new Error(`Failed to send Telegram message with reply keyboard remove: ${errorMessage}`);
    }
    logger.error(
      { chatId, error: error instanceof Error ? error.message : String(error) },
      'Telegram API error'
    );
    throw error;
  }
}

export async function sendPhoto(
  logger: Logger,
  botToken: string,
  chatId: number,
  photoUrl: string,
  caption?: string,
  parseMode: 'HTML' | 'Markdown' | 'MarkdownV2' = 'HTML',
  replyMarkup?: any
): Promise<number> {
  const startTime = Date.now();
  const sanitizedCaption = caption ? normalizeText(caption, parseMode) : undefined;
  const parseModeToSend = parseMode;
  const url = `${TELEGRAM_API_BASE_URL}${botToken}/sendPhoto`;
  try {
    const response = await axios.post(
      url,
      {
        chat_id: chatId,
        photo: photoUrl,
        caption: sanitizedCaption,
        parse_mode: caption ? parseModeToSend : undefined,
        reply_markup: replyMarkup,
      },
      {
        timeout: 10000,
      }
    );

    if (!response.data.ok) {
      throw new Error(`Telegram API error: ${response.data.description}`);
    }

    logger.info(
      { chatId, messageId: response.data?.result?.message_id, duration: Date.now() - startTime },
      'Telegram photo sent'
    );

    return response.data?.result?.message_id;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error(
        { chatId, error: error.message, statusCode: error.response?.status },
        'Telegram API error'
      );
      const errorMessage = error.response?.data?.description || error.message;
      throw new Error(`Failed to send Telegram photo: ${errorMessage}`);
    }
    logger.error(
      { chatId, error: error instanceof Error ? error.message : String(error) },
      'Telegram API error'
    );
    throw error;
  }
}

export function buildVideoOptionsForSdk(
  caption?: string,
  parseMode: 'HTML' | 'Markdown' | 'MarkdownV2' = 'HTML',
  cover?: string,
  thumbnail?: string,
  replyMarkup?: any
): Record<string, any> {
  const sanitizedCaption = caption ? normalizeText(caption, parseMode) : undefined;
  const parseModeToSend = parseMode;
  const thumbnailToSend = thumbnail && thumbnail.startsWith('attach://') ? thumbnail : undefined;
  const options: Record<string, any> = {
    caption: sanitizedCaption,
    parse_mode: caption ? parseModeToSend : undefined,
    cover,
    reply_markup: replyMarkup,
  };
  if (thumbnailToSend) {
    options.thumbnail = thumbnailToSend;
    options.thumb = thumbnailToSend;
  }
  return options;
}

export async function sendVideo(
  logger: Logger,
  botToken: string,
  chatId: number,
  videoUrl: string,
  caption?: string,
  parseMode: 'HTML' | 'Markdown' | 'MarkdownV2' = 'HTML',
  cover?: string,
  replyMarkup?: any,
  thumbnail?: string
): Promise<number> {
  const startTime = Date.now();
  const sanitizedCaption = caption ? normalizeText(caption, parseMode) : undefined;
  const parseModeToSend = parseMode;
  const thumbnailToSend = thumbnail && thumbnail.startsWith('attach://') ? thumbnail : undefined;
  const url = `${TELEGRAM_API_BASE_URL}${botToken}/sendVideo`;
  try {
    const response = await axios.post(
      url,
      {
        chat_id: chatId,
        video: videoUrl,
        caption: sanitizedCaption,
        parse_mode: caption ? parseModeToSend : undefined,
        cover: cover,
        ...(thumbnailToSend ? { thumbnail: thumbnailToSend } : {}),
        // thumbnail is ignored in URL-based mode (multipart-only)
        reply_markup: replyMarkup,
      },
      {
        timeout: 10000,
      }
    );

    if (!response.data.ok) {
      throw new Error(`Telegram API error: ${response.data.description}`);
    }

    logger.info(
      { chatId, messageId: response.data?.result?.message_id, duration: Date.now() - startTime },
      'Telegram video sent'
    );

    return response.data?.result?.message_id;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error(
        { chatId, error: error.message, statusCode: error.response?.status },
        'Telegram API error'
      );
      const errorMessage = error.response?.data?.description || error.message;
      throw new Error(`Failed to send Telegram video: ${errorMessage}`);
    }
    logger.error(
      { chatId, error: error instanceof Error ? error.message : String(error) },
      'Telegram API error'
    );
    throw error;
  }
}

export async function sendDocument(
  logger: Logger,
  botToken: string,
  chatId: number,
  documentUrl: string,
  caption?: string,
  parseMode: 'HTML' | 'Markdown' | 'MarkdownV2' = 'HTML',
  replyMarkup?: any
): Promise<number> {
  const startTime = Date.now();
  const sanitizedCaption = caption ? normalizeText(caption, parseMode) : undefined;
  const parseModeToSend = parseMode;
  const url = `${TELEGRAM_API_BASE_URL}${botToken}/sendDocument`;
  try {
    const response = await axios.post(
      url,
      {
        chat_id: chatId,
        document: documentUrl,
        caption: sanitizedCaption,
        parse_mode: caption ? parseModeToSend : undefined,
        reply_markup: replyMarkup,
      },
      {
        timeout: 10000,
      }
    );

    if (!response.data.ok) {
      throw new Error(`Telegram API error: ${response.data.description}`);
    }

    logger.info(
      { chatId, messageId: response.data?.result?.message_id, duration: Date.now() - startTime },
      'Telegram document sent'
    );

    return response.data?.result?.message_id;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error(
        { chatId, error: error.message, statusCode: error.response?.status },
        'Telegram API error'
      );
      const errorMessage = error.response?.data?.description || error.message;
      throw new Error(`Failed to send Telegram document: ${errorMessage}`);
    }
    logger.error(
      { chatId, error: error instanceof Error ? error.message : String(error) },
      'Telegram API error'
    );
    throw error;
  }
}

export async function sendAudio(
  logger: Logger,
  botToken: string,
  chatId: number,
  audioUrl: string,
  caption?: string,
  parseMode: 'HTML' | 'Markdown' | 'MarkdownV2' = 'HTML',
  replyMarkup?: any
): Promise<number> {
  const startTime = Date.now();
  const sanitizedCaption = caption ? normalizeText(caption, parseMode) : undefined;
  const parseModeToSend = parseMode;
  const url = `${TELEGRAM_API_BASE_URL}${botToken}/sendAudio`;
  try {
    const response = await axios.post(
      url,
      {
        chat_id: chatId,
        audio: audioUrl,
        caption: sanitizedCaption,
        parse_mode: caption ? parseModeToSend : undefined,
        reply_markup: replyMarkup,
      },
      {
        timeout: 10000,
      }
    );

    if (!response.data.ok) {
      throw new Error(`Telegram API error: ${response.data.description}`);
    }

    logger.info(
      { chatId, messageId: response.data?.result?.message_id, duration: Date.now() - startTime },
      'Telegram audio sent'
    );

    return response.data?.result?.message_id;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error(
        { chatId, error: error.message, statusCode: error.response?.status },
        'Telegram API error'
      );
      const errorMessage = error.response?.data?.description || error.message;
      throw new Error(`Failed to send Telegram audio: ${errorMessage}`);
    }
    logger.error(
      { chatId, error: error instanceof Error ? error.message : String(error) },
      'Telegram API error'
    );
    throw error;
  }
}

export async function sendMediaGroup(
  logger: Logger,
  botToken: string,
  chatId: number,
  media: Array<{ type: 'photo' | 'video'; url: string; caption?: string }>,
  parseMode: 'HTML' | 'Markdown' | 'MarkdownV2' = 'HTML'
): Promise<number | null> {
  const startTime = Date.now();
  const url = `${TELEGRAM_API_BASE_URL}${botToken}/sendMediaGroup`;
  const parseModeToSend = parseMode === 'HTML' ? parseMode : undefined;
  const payload = media.map((item) => {
    const sanitizedCaption = item.caption ? normalizeText(item.caption, parseMode) : undefined;
    return {
      type: item.type,
      media: item.url,
      caption: sanitizedCaption,
      parse_mode: item.caption ? parseModeToSend : undefined,
    };
  });

  try {
    const response = await axios.post(
      url,
      {
        chat_id: chatId,
        media: payload,
      },
      {
        timeout: 10000,
      }
    );

    if (!response.data.ok) {
      throw new Error(`Telegram API error: ${response.data.description}`);
    }

    const firstMessageId = response.data?.result?.[0]?.message_id ?? null;
    logger.info(
      { chatId, messageId: firstMessageId, duration: Date.now() - startTime },
      'Telegram media group sent'
    );

    return firstMessageId;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error(
        { chatId, error: error.message, statusCode: error.response?.status },
        'Telegram API error'
      );
      const errorMessage = error.response?.data?.description || error.message;
      throw new Error(`Failed to send Telegram media group: ${errorMessage}`);
    }
    logger.error(
      { chatId, error: error instanceof Error ? error.message : String(error) },
      'Telegram API error'
    );
    throw error;
  }
}

/**
 * Ответить на callback_query
 */
export async function answerCallbackQuery(
  logger: Logger,
  botToken: string,
  callbackQueryId: string,
  text?: string
): Promise<any> {
  const url = `${TELEGRAM_API_BASE_URL}${botToken}/answerCallbackQuery`;
  try {
    const response = await axios.post(url, {
      callback_query_id: callbackQueryId,
      text: text,
      show_alert: false,
    }, {
      timeout: 10000,
    });

    if (!response.data.ok) {
      throw new Error(`Telegram API error: ${response.data.description}`);
    }
    
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const errorMessage = error.response?.data?.description || error.message;
      throw new Error(`Failed to answer callback query: ${errorMessage}`);
    }
    throw error;
  }
}

/**
 * Получение информации о боте
 */
export async function getBotInfo(
  logger: Logger,
  botToken: string
): Promise<any> {
  try {
    const url = `${TELEGRAM_API_BASE_URL}${botToken}/getMe`;
    
    const response = await axios.get(url, {
      timeout: 10000,
    });

    if (!response.data.ok) {
      throw new Error(`Telegram API error: ${response.data.description}`);
    }

    return response.data.result;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const errorMessage = error.response?.data?.description || error.message;
      throw new Error(`Failed to get bot info: ${errorMessage}`);
    }
    throw error;
  }
}

