export interface BotUser {
  id: string;
  bot_id: string;
  telegram_user_id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  phone_number: string | null;
  email: string | null;
  language_code: string | null;
  first_interaction_at: Date;
  last_interaction_at: Date;
  interaction_count: number;
  metadata: Record<string, unknown> | null;
}

export interface BotUserStats {
  total: number;
  newLast7Days: number;
  conversionRate: number;
}

export type BotUserUpsertData = {
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  phone_number?: string | null;
  email?: string | null;
  language_code?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type CursorPaginationParams = {
  limit: number;
  cursor?: string;
};

export type PaginatedBotUsers = {
  users: BotUser[];
  nextCursor: string | null;
  hasMore: boolean;
};

type QueryResult<Row> = { rows: Row[] };

export type DbClient = {
  query: <Row = any>(text: string, params?: any[]) => Promise<QueryResult<Row>>;
};

type BotUserCursor = { first_interaction_at: string; id: string };

function encodeCursor(cursor: BotUserCursor): string {
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

function decodeCursor(cursor?: string): BotUserCursor | null {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as BotUserCursor;
  } catch {
    return null;
  }
}

export async function createOrUpdateBotUserWithClient(
  client: DbClient,
  botId: string,
  telegramUserId: string,
  data: BotUserUpsertData
): Promise<BotUser> {
  // Verify bot exists to provide better error message
  const botCheck = await client.query('SELECT id FROM bots WHERE id = $1', [botId]);
  if (botCheck.rows.length === 0) {
    throw new Error(`Bot with id ${botId} does not exist. Cannot create bot user.`);
  }

  const result = await client.query<BotUser>(
    `INSERT INTO bot_users (
        bot_id,
        telegram_user_id,
        first_name,
        last_name,
        username,
        phone_number,
        email,
        language_code,
        first_interaction_at,
        last_interaction_at,
        interaction_count,
        metadata
      )
      VALUES ($1, $2::bigint, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, $9)
      ON CONFLICT (bot_id, telegram_user_id)
      DO UPDATE SET
        first_name = COALESCE(EXCLUDED.first_name, bot_users.first_name),
        last_name = COALESCE(EXCLUDED.last_name, bot_users.last_name),
        username = COALESCE(EXCLUDED.username, bot_users.username),
        phone_number = COALESCE(EXCLUDED.phone_number, bot_users.phone_number),
        email = COALESCE(EXCLUDED.email, bot_users.email),
        language_code = COALESCE(EXCLUDED.language_code, bot_users.language_code),
        metadata = COALESCE(EXCLUDED.metadata, bot_users.metadata),
        last_interaction_at = CURRENT_TIMESTAMP,
        interaction_count = bot_users.interaction_count + 1
      RETURNING
        id,
        bot_id,
        telegram_user_id::text as telegram_user_id,
        first_name,
        last_name,
        username,
        phone_number,
        email,
        language_code,
        first_interaction_at,
        last_interaction_at,
        interaction_count,
        metadata`,
    [
      botId,
      telegramUserId,
      data.first_name ?? null,
      data.last_name ?? null,
      data.username ?? null,
      data.phone_number ?? null,
      data.email ?? null,
      data.language_code ?? null,
      data.metadata ?? null,
    ]
  );

  return result.rows[0];
}

export async function getBotUsersWithClient(
  client: DbClient,
  botId: string,
  userId: number,
  params: CursorPaginationParams
): Promise<PaginatedBotUsers> {
  const limit = Math.min(Math.max(params.limit, 1), 100);
  const decoded = decodeCursor(params.cursor);

  const values: Array<string | number> = [botId, userId, limit + 1];
  let whereClause = 'WHERE bu.bot_id = $1';

  if (decoded) {
    values.push(decoded.first_interaction_at, decoded.id);
    const firstInteractionIndex = values.length - 1;
    const idIndex = values.length;
    whereClause += ` AND (bu.first_interaction_at, bu.id) < ($${firstInteractionIndex}, $${idIndex})`;
  }

  const result = await client.query<BotUser>(
    `SELECT
        bu.id,
        bu.bot_id,
        bu.telegram_user_id::text as telegram_user_id,
        bu.first_name,
        bu.last_name,
        bu.username,
        bu.phone_number,
        bu.email,
        bu.language_code,
        bu.first_interaction_at,
        bu.last_interaction_at,
        bu.interaction_count,
        bu.metadata
      FROM bot_users bu
      JOIN bots b ON b.id = bu.bot_id AND b.user_id = $2
      ${whereClause}
      ORDER BY bu.first_interaction_at DESC, bu.id DESC
      LIMIT $3`,
    values
  );

  const rows = result.rows;
  const hasMore = rows.length > limit;
  const users = hasMore ? rows.slice(0, limit) : rows;

  const last = users[users.length - 1];
  const cursorTimestamp = formatCursorTimestamp((last as any)?.first_interaction_at);
  const nextCursor =
    hasMore && last
      ? encodeCursor({
          first_interaction_at: cursorTimestamp,
          id: String((last as any).id),
        })
      : null;

  return { users, nextCursor, hasMore };
}

export async function getBotUserStatsWithClient(
  client: DbClient,
  botId: string,
  userId: number
): Promise<BotUserStats> {
  const result = await client.query<{
    total: string;
    new_last_7_days: string;
    conversion_rate: string | null;
  }>(
    `SELECT
        COUNT(*)::text as total,
        COUNT(*) FILTER (WHERE bu.first_interaction_at >= NOW() - INTERVAL '7 days')::text as new_last_7_days,
        CASE
          WHEN COUNT(*) = 0 THEN 0
          ELSE (COUNT(*) FILTER (WHERE bu.phone_number IS NOT NULL)::decimal / COUNT(*)::decimal)
        END as conversion_rate
      FROM bot_users bu
      JOIN bots b ON b.id = bu.bot_id AND b.user_id = $2
      WHERE bu.bot_id = $1`,
    [botId, userId]
  );

  const row = result.rows[0];
  return {
    total: Number(row?.total ?? 0),
    newLast7Days: Number(row?.new_last_7_days ?? 0),
    conversionRate: Number(row?.conversion_rate ?? 0),
  };
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

export async function exportBotUsersToCSVWithClient(
  client: DbClient,
  botId: string,
  userId: number
): Promise<string> {
  const result = await client.query<BotUser>(
    `SELECT
        bu.id,
        bu.bot_id,
        bu.telegram_user_id::text as telegram_user_id,
        bu.first_name,
        bu.last_name,
        bu.username,
        bu.phone_number,
        bu.email,
        bu.language_code,
        bu.first_interaction_at,
        bu.last_interaction_at,
        bu.interaction_count,
        bu.metadata
      FROM bot_users bu
      JOIN bots b ON b.id = bu.bot_id AND b.user_id = $2
      WHERE bu.bot_id = $1
      ORDER BY bu.first_interaction_at DESC, bu.id DESC`,
    [botId, userId]
  );

  const headers = [
    'id',
    'bot_id',
    'telegram_user_id',
    'first_name',
    'last_name',
    'username',
    'phone_number',
    'email',
    'language_code',
    'first_interaction_at',
    'last_interaction_at',
    'interaction_count',
    'metadata',
  ];

  const rows = result.rows.map((row) =>
    [
      row.id,
      row.bot_id,
      row.telegram_user_id,
      row.first_name,
      row.last_name,
      row.username,
      row.phone_number,
      row.email,
      row.language_code,
      row.first_interaction_at,
      row.last_interaction_at,
      row.interaction_count,
      row.metadata ? JSON.stringify(row.metadata) : null,
    ]
      .map(escapeCsvValue)
      .join(',')
  );

  return [headers.join(','), ...rows].join('\n');
}
