import { DbClient } from './bot-users';
import type {
  AnalyticsEvent,
  AnalyticsStats,
  PopularPath,
  FunnelStep,
  TimeSeriesData,
  AnalyticsEventsParams,
  AnalyticsEventData,
} from '../types/analytics';

export type {
  AnalyticsEvent,
  AnalyticsStats,
  PopularPath,
  FunnelStep,
  TimeSeriesData,
  AnalyticsEventsParams,
  AnalyticsEventData,
} from '../types/analytics';

type AnalyticsCursor = { created_at: string; id: string };

function encodeCursor(cursor: AnalyticsCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64');
}

function formatCursorTimestamp(value: unknown): string {
  if (value instanceof Date) {
    const pad = (num: number, size = 2) => String(num).padStart(size, '0');
    return [
      `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
      `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}.${pad(value.getMilliseconds(), 3)}`,
    ].join(' ');
  }
  return String(value ?? '');
}

function decodeCursor(cursor?: string): AnalyticsCursor | null {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as AnalyticsCursor;
  } catch {
    return null;
  }
}

export async function logAnalyticsEventWithClient(
  client: DbClient,
  botId: string,
  telegramUserId: string | number,
  sourceUpdateId: string | number,
  eventType: string,
  data: AnalyticsEventData = {}
): Promise<void> {
  await client.query(
    `INSERT INTO bot_analytics (
        bot_id,
        telegram_user_id,
        source_update_id,
        event_type,
        state_from,
        state_to,
        button_text,
        metadata
      )
      VALUES ($1, $2::bigint, $3::bigint, $4, $5, $6, $7, $8)
      ON CONFLICT (bot_id, source_update_id, event_type)
      DO NOTHING`,
    [
      botId,
      telegramUserId,
      sourceUpdateId,
      eventType,
      data.stateFrom ?? null,
      data.stateTo ?? null,
      data.buttonText ?? null,
      data.metadata ?? null,
    ]
  );
}

export async function getAnalyticsEventsWithClient(
  client: DbClient,
  botId: string,
  userId: number,
  params: AnalyticsEventsParams
): Promise<{ events: AnalyticsEvent[]; nextCursor: string | null; hasMore: boolean }> {
  const limit = Math.min(Math.max(params.limit, 1), 100);
  const decoded = decodeCursor(params.cursor);

  const values: Array<string | number> = [botId, userId, limit + 1];
  let whereClause = 'WHERE ba.bot_id = $1';

  if (params.eventType) {
    values.push(params.eventType);
    whereClause += ` AND ba.event_type = $${values.length}`;
  }
  if (params.dateFrom) {
    values.push(params.dateFrom);
    whereClause += ` AND ba.created_at >= $${values.length}`;
  }
  if (params.dateTo) {
    values.push(params.dateTo);
    whereClause += ` AND ba.created_at <= $${values.length}`;
  }
  if (decoded) {
    values.push(decoded.created_at, decoded.id);
    const createdAtIndex = values.length - 1;
    const idIndex = values.length;
    whereClause += ` AND (ba.created_at, ba.id) < ($${createdAtIndex}, $${idIndex})`;
  }

  const result = await client.query<AnalyticsEvent>(
    `SELECT
        ba.id,
        ba.bot_id,
        ba.telegram_user_id::text as telegram_user_id,
        ba.source_update_id::text as source_update_id,
        ba.event_type,
        ba.state_from,
        ba.state_to,
        ba.button_text,
        ba.metadata,
        ba.created_at
      FROM bot_analytics ba
      JOIN bots b ON b.id = ba.bot_id AND b.user_id = $2
      ${whereClause}
      ORDER BY ba.created_at DESC, ba.id DESC
      LIMIT $3`,
    values
  );

  const rows = result.rows;
  const hasMore = rows.length > limit;
  const events = hasMore ? rows.slice(0, limit) : rows;

  const last = events[events.length - 1];
  const cursorTimestamp = formatCursorTimestamp((last as any)?.created_at);
  const nextCursor =
    hasMore && last
      ? encodeCursor({
          created_at: cursorTimestamp,
          id: String((last as any).id),
        })
      : null;

  return { events, nextCursor, hasMore };
}

export async function getAnalyticsStatsWithClient(
  client: DbClient,
  botId: string,
  userId: number,
  dateFrom?: string,
  dateTo?: string
): Promise<AnalyticsStats> {
  const totalUsersResult = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text as total
      FROM bot_users bu
      JOIN bots b ON b.id = bu.bot_id AND b.user_id = $2
      WHERE bu.bot_id = $1`,
    [botId, userId]
  );

  const values: Array<string | number> = [botId, userId];
  let dateClause = '';
  if (dateFrom) {
    values.push(dateFrom);
    dateClause += ` AND ba.created_at >= $${values.length}`;
  }
  if (dateTo) {
    values.push(dateTo);
    dateClause += ` AND ba.created_at <= $${values.length}`;
  }

  const analyticsResult = await client.query<{
    total_events: string;
    unique_users: string;
    avg_active_span: string | null;
  }>(
    `WITH filtered AS (
        SELECT ba.telegram_user_id, ba.created_at
        FROM bot_analytics ba
        JOIN bots b ON b.id = ba.bot_id AND b.user_id = $2
        WHERE ba.bot_id = $1${dateClause}
      ),
      spans AS (
        SELECT telegram_user_id, MAX(created_at) as max_created, MIN(created_at) as min_created
        FROM filtered
        GROUP BY telegram_user_id
      )
      SELECT
        (SELECT COUNT(*)::text FROM filtered) as total_events,
        (SELECT COUNT(DISTINCT telegram_user_id)::text FROM filtered) as unique_users,
        (SELECT AVG(EXTRACT(EPOCH FROM (max_created - min_created))) FROM spans) as avg_active_span`,
    values
  );

  const totalUsers = Number(totalUsersResult.rows[0]?.total ?? 0);
  const analyticsRow = analyticsResult.rows[0] ?? {
    total_events: '0',
    unique_users: '0',
    avg_active_span: null,
  };
  return {
    totalUsers,
    totalEvents: Number(analyticsRow.total_events ?? 0),
    uniqueUsers: Number(analyticsRow.unique_users ?? 0),
    avgActiveSpan: Number(analyticsRow.avg_active_span ?? 0),
  };
}

export async function getPopularPathsWithClient(
  client: DbClient,
  botId: string,
  userId: number,
  limit: number,
  dateFrom?: string,
  dateTo?: string
): Promise<PopularPath[]> {
  const limitValue = Math.min(Math.max(limit, 1), 100);
  const values: Array<string | number> = [botId, userId, limitValue];
  let dateClause = '';
  if (dateFrom) {
    values.push(dateFrom);
    dateClause += ` AND ba.created_at >= $${values.length}`;
  }
  if (dateTo) {
    values.push(dateTo);
    dateClause += ` AND ba.created_at <= $${values.length}`;
  }

  const totalParams: Array<string | number> = [botId, userId];
  let totalDateClause = '';
  if (dateFrom) {
    totalParams.push(dateFrom);
    totalDateClause += ` AND ba.created_at >= $${totalParams.length}`;
  }
  if (dateTo) {
    totalParams.push(dateTo);
    totalDateClause += ` AND ba.created_at <= $${totalParams.length}`;
  }

  const totalResult = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text as total
      FROM bot_analytics ba
      JOIN bots b ON b.id = ba.bot_id AND b.user_id = $2
      WHERE ba.bot_id = $1 AND ba.event_type = 'state_transition'${totalDateClause}`,
    totalParams
  );
  const total = Number(totalResult.rows[0]?.total ?? 0);

  const result = await client.query<{
    state_from: string | null;
    state_to: string | null;
    count: string;
  }>(
    `SELECT
        ba.state_from,
        ba.state_to,
        COUNT(*)::text as count
      FROM bot_analytics ba
      JOIN bots b ON b.id = ba.bot_id AND b.user_id = $2
      WHERE ba.bot_id = $1 AND ba.event_type = 'state_transition'${dateClause}
      GROUP BY ba.state_from, ba.state_to
      ORDER BY count DESC
      LIMIT $3`,
    values
  );

  return result.rows.map((row) => ({
    stateFrom: row.state_from,
    stateTo: row.state_to,
    count: Number(row.count ?? 0),
    percentage: total > 0 ? Number(row.count ?? 0) / total : 0,
  }));
}

export async function getFunnelDataWithClient(
  client: DbClient,
  botId: string,
  userId: number,
  stateKeys: string[],
  dateFrom?: string,
  dateTo?: string
): Promise<FunnelStep[]> {
  const steps = stateKeys.filter(Boolean);
  if (steps.length === 0) {
    return [];
  }

  const fetchUsers = async (stateKey: string) => {
    const values: Array<string | number> = [botId, userId, stateKey];
    let dateClause = '';
    if (dateFrom) {
      values.push(dateFrom);
      dateClause += ` AND ba.created_at >= $${values.length}`;
    }
    if (dateTo) {
      values.push(dateTo);
      dateClause += ` AND ba.created_at <= $${values.length}`;
    }

    const result = await client.query<{ telegram_user_id: string }>(
      `SELECT DISTINCT ba.telegram_user_id::text as telegram_user_id
        FROM bot_analytics ba
        JOIN bots b ON b.id = ba.bot_id AND b.user_id = $2
        WHERE ba.bot_id = $1
          AND ba.event_type = 'state_transition'
          AND ba.state_to = $3${dateClause}`,
      values
    );
    return new Set(result.rows.map((row) => row.telegram_user_id));
  };

  const userSets = await Promise.all(steps.map((stateKey) => fetchUsers(stateKey)));

  return steps.map((stateKey, index) => {
    const current = userSets[index];
    if (index === 0) {
      return {
        stateName: stateKey,
        usersEntered: current.size,
        usersExited: 0,
        conversionRate: current.size > 0 ? 1 : 0,
      };
    }

    const prev = userSets[index - 1];
    let intersection = 0;
    for (const userIdValue of current) {
      if (prev.has(userIdValue)) {
        intersection += 1;
      }
    }
    const prevCount = prev.size;
    return {
      stateName: stateKey,
      usersEntered: current.size,
      usersExited: Math.max(prevCount - intersection, 0),
      conversionRate: prevCount > 0 ? intersection / prevCount : 0,
    };
  });
}

export async function getTimeSeriesDataWithClient(
  client: DbClient,
  botId: string,
  userId: number,
  eventType: string,
  dateFrom?: string,
  dateTo?: string,
  granularity: 'hour' | 'day' | 'week' = 'day'
): Promise<TimeSeriesData[]> {
  const safeGranularity =
    granularity === 'hour' || granularity === 'day' || granularity === 'week'
      ? granularity
      : 'day';

  const values: Array<string | number> = [botId, userId, eventType];
  let dateClause = '';
  if (dateFrom) {
    values.push(dateFrom);
    dateClause += ` AND ba.created_at >= $${values.length}`;
  }
  if (dateTo) {
    values.push(dateTo);
    dateClause += ` AND ba.created_at <= $${values.length}`;
  }

  const result = await client.query<{ date: Date; count: string }>(
    `SELECT DATE_TRUNC('${safeGranularity}', ba.created_at) as date, COUNT(*)::text as count
      FROM bot_analytics ba
      JOIN bots b ON b.id = ba.bot_id AND b.user_id = $2
      WHERE ba.bot_id = $1
        AND ba.event_type = $3${dateClause}
      GROUP BY date
      ORDER BY date ASC`,
    values
  );

  return result.rows.map((row) => ({
    date: row.date instanceof Date ? row.date.toISOString() : String(row.date),
    count: Number(row.count ?? 0),
  }));
}

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const stringValue = String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

export async function exportAnalyticsToCSVWithClient(
  client: DbClient,
  botId: string,
  userId: number,
  dateFrom?: string,
  dateTo?: string
): Promise<string> {
  const values: Array<string | number> = [botId, userId];
  let dateClause = '';
  if (dateFrom) {
    values.push(dateFrom);
    dateClause += ` AND ba.created_at >= $${values.length}`;
  }
  if (dateTo) {
    values.push(dateTo);
    dateClause += ` AND ba.created_at <= $${values.length}`;
  }

  const result = await client.query<AnalyticsEvent>(
    `SELECT
        ba.id,
        ba.bot_id,
        ba.telegram_user_id::text as telegram_user_id,
        ba.source_update_id::text as source_update_id,
        ba.event_type,
        ba.state_from,
        ba.state_to,
        ba.button_text,
        ba.metadata,
        ba.created_at
      FROM bot_analytics ba
      JOIN bots b ON b.id = ba.bot_id AND b.user_id = $2
      WHERE ba.bot_id = $1${dateClause}
      ORDER BY ba.created_at DESC, ba.id DESC`,
    values
  );

  const headers = [
    'id',
    'bot_id',
    'telegram_user_id',
    'source_update_id',
    'event_type',
    'state_from',
    'state_to',
    'button_text',
    'metadata',
    'created_at',
  ];

  const rows = result.rows.map((row) =>
    [
      row.id,
      row.bot_id,
      row.telegram_user_id,
      row.source_update_id,
      row.event_type,
      row.state_from,
      row.state_to,
      row.button_text,
      row.metadata ? JSON.stringify(row.metadata) : null,
      row.created_at,
    ]
      .map(escapeCsvValue)
      .join(',')
  );

  return [headers.join(','), ...rows].join('\n');
}
