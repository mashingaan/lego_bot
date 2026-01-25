import { getPostgresClient } from './postgres';

export type AuditLogParams = {
  userId: number;
  requestId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  metadata?: unknown;
  ipAddress?: string;
  userAgent?: string;
};

function limitMetadataSize(metadata: unknown): unknown | null {
  if (metadata === undefined) {
    return null;
  }
  const serialized = JSON.stringify(metadata);
  if (serialized.length > 4096) {
    return { truncated: true };
  }
  return metadata;
}

export async function logAuditEvent(params: AuditLogParams): Promise<void> {
  const client = await getPostgresClient();
  try {
    const metadata = limitMetadataSize(params.metadata);
    await client.query(
      `INSERT INTO audit_logs (user_id, request_id, action, resource_type, resource_id, metadata, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        params.userId,
        params.requestId ?? null,
        params.action,
        params.resourceType,
        params.resourceId ?? null,
        metadata,
        params.ipAddress ?? null,
        params.userAgent ?? null,
      ]
    );
  } finally {
    client.release();
  }
}
