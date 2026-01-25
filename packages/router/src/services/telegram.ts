import axios from 'axios';
import { BotSchema } from '@dialogue-constructor/shared/types/bot-schema';
import { sanitizeHtml } from '@dialogue-constructor/shared';
import type { Logger } from '@dialogue-constructor/shared';

const TELEGRAM_API_BASE_URL = 'https://api.telegram.org/bot';

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
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
  text: string
): Promise<void> {
  const startTime = Date.now();
  const sanitizedText = sanitizeHtml(text);
  logger.debug({ chatId, textLength: sanitizedText.length }, 'Sending Telegram message');
  try {
    const url = `${TELEGRAM_API_BASE_URL}${botToken}/sendMessage`;
    
    const response = await axios.post(url, {
      chat_id: chatId,
      text: sanitizedText,
      parse_mode: 'HTML',
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
  buttons: Array<{ text: string; nextState: string }>
): Promise<any> {
  const startTime = Date.now();
  const sanitizedText = sanitizeHtml(text);
  logger.debug({ chatId, textLength: sanitizedText.length }, 'Sending Telegram message');
  const url = `${TELEGRAM_API_BASE_URL}${botToken}/sendMessage`;
  
  // Преобразуем кнопки в формат Telegram InlineKeyboardMarkup
  // Группируем по 2 кнопки в ряд
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let i = 0; i < buttons.length; i += 2) {
    const row = buttons.slice(i, i + 2).map(btn => ({
      text: btn.text,
      callback_data: btn.nextState,
    }));
    keyboard.push(row);
  }

  try {
    const response = await axios.post(url, {
      chat_id: chatId,
      text: sanitizedText,
      parse_mode: 'HTML',
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

