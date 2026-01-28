import {
  getBroadcastById,
  getBroadcastStats,
  getNextPendingMessages,
  resetStaleSendingMessages,
  updateBroadcast,
  updateMessageStatus,
} from '../db/broadcasts';
import { getBotByIdAnyUser } from '../db/bots';
import {
  sendTelegramMessage,
  sendPhoto,
  sendVideo,
  sendDocument,
  sendAudio,
  logger,
  logBroadcastMessageFailed,
  logBroadcastMessageSent,
  logBroadcastProcessingDuration,
} from '@dialogue-constructor/shared';

const TELEGRAM_RATE_LIMIT = 30;
const BATCH_SIZE = 30;
const RUN_BUDGET_MS = 8000;
const PER_MESSAGE_DELAY_MS = Math.ceil(1000 / TELEGRAM_RATE_LIMIT);
const MAX_MESSAGES_PER_RUN = 240;
const SENDING_LEASE_MS = 5 * 60 * 1000;

export async function processBroadcast(broadcastId: string) {
  const startTime = Date.now();
  let processed = 0;
  let sentCount = 0;
  let failedCount = 0;

  const broadcast = await getBroadcastById(broadcastId, null);
  if (!broadcast || broadcast.status !== 'processing') {
    return;
  }

  const bot = await getBotByIdAnyUser(broadcast.bot_id);
  if (!bot) {
    await updateBroadcast(broadcastId, { status: 'failed' });
    return;
  }

  await updateBroadcast(broadcastId, { status: 'processing', started_at: new Date() });

  logger.info(
    {
      broadcastId,
      botId: broadcast.bot_id,
      totalRecipients: broadcast.total_recipients,
      status: 'started',
    },
    'Broadcast processing started'
  );

  const resetCount = await resetStaleSendingMessages(
    broadcastId,
    new Date(Date.now() - SENDING_LEASE_MS)
  );
  if (resetCount > 0) {
    logger.warn({ broadcastId, resetCount }, 'Reset stale sending messages');
  }

  while (Date.now() - startTime < RUN_BUDGET_MS && processed < MAX_MESSAGES_PER_RUN) {
    const messages = await getNextPendingMessages(broadcastId, BATCH_SIZE);
    if (messages.length === 0) {
      const stats = await getBroadcastStats(broadcastId);
      if (stats.pending === 0 && stats.sending === 0) {
        await updateBroadcast(broadcastId, { status: 'completed', completed_at: new Date() });
        logger.info(
          {
            broadcastId,
            sent: sentCount,
            failed: failedCount,
            duration: Date.now() - startTime,
          },
          'Broadcast processing completed'
        );
        logBroadcastProcessingDuration(logger, {
          broadcastId,
          botId: broadcast.bot_id,
          durationSeconds: (Date.now() - startTime) / 1000,
        });
      }
      return;
    }

    for (const msg of messages) {
      try {
        let telegramMessageId: number | undefined;
        if (broadcast.media) {
          telegramMessageId = await sendMediaMessage(logger, bot.token, msg.telegram_user_id, {
            media: broadcast.media,
            message: broadcast.message,
            parse_mode: broadcast.parse_mode,
          });
        } else {
          telegramMessageId = await sendTelegramMessage(
            logger,
            bot.token,
            msg.telegram_user_id,
            broadcast.message,
            (broadcast.parse_mode ?? 'HTML') as 'HTML' | 'Markdown' | 'MarkdownV2'
          );
        }

        await updateMessageStatus(msg.id, 'sent', undefined, telegramMessageId);
        sentCount += 1;
        logBroadcastMessageSent(logger, {
          broadcastId,
          botId: broadcast.bot_id,
          telegramUserId: msg.telegram_user_id,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        await updateMessageStatus(msg.id, 'failed', errorMsg);
        failedCount += 1;
        logBroadcastMessageFailed(logger, {
          broadcastId,
          botId: broadcast.bot_id,
          telegramUserId: msg.telegram_user_id,
        });
      }

      processed += 1;
      if (Date.now() - startTime >= RUN_BUDGET_MS || processed >= MAX_MESSAGES_PER_RUN) {
        break;
      }

      await sleep(PER_MESSAGE_DELAY_MS);
    }
  }

  const finalStats = await getBroadcastStats(broadcastId);
  if (finalStats.pending === 0 && finalStats.sending === 0) {
    await updateBroadcast(broadcastId, { status: 'completed', completed_at: new Date() });
    logger.info(
      {
        broadcastId,
        sent: sentCount,
        failed: failedCount,
        duration: Date.now() - startTime,
      },
      'Broadcast processing completed'
    );
    logBroadcastProcessingDuration(logger, {
      broadcastId,
      botId: broadcast.bot_id,
      durationSeconds: (Date.now() - startTime) / 1000,
    });
  }
}

export function processBroadcastAsync(broadcastId: string) {
  setTimeout(() => {
    processBroadcast(broadcastId).catch((error) => {
      logger.error({ broadcastId, error }, 'Broadcast processing failed');
    });
  }, 0);
}

async function sendMediaMessage(
  loggerInstance: typeof logger,
  botToken: string,
  chatId: number,
  broadcast: {
    media: {
      type: 'photo' | 'video' | 'document' | 'audio';
      url: string;
      cover?: string;
      thumbnail?: string;
    };
    message: string;
    parse_mode: 'HTML' | 'Markdown' | 'MarkdownV2' | null;
  }
): Promise<number | undefined> {
  const parseMode = (broadcast.parse_mode ?? 'HTML') as 'HTML' | 'Markdown' | 'MarkdownV2';
  const { media, message } = broadcast;

  switch (media.type) {
    case 'photo':
      return sendPhoto(loggerInstance, botToken, chatId, media.url, message, parseMode);
    case 'video':
      return sendVideo(
        loggerInstance,
        botToken,
        chatId,
        media.url,
        message,
        parseMode,
        media.cover,
        media.thumbnail
      );
    case 'document':
      return sendDocument(loggerInstance, botToken, chatId, media.url, message, parseMode);
    case 'audio':
      return sendAudio(loggerInstance, botToken, chatId, media.url, message, parseMode);
  }
  return undefined;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
