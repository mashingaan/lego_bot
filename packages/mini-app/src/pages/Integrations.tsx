import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../utils/api';
import { BotSchema } from '../types';
import './Integrations.css';

type WebhookLog = {
  id: string;
  state_key: string;
  telegram_user_id: number;
  webhook_url: string;
  response_status: number | null;
  error_message: string | null;
  created_at: string;
};

type WebhookStats = {
  total: number;
  successRate: number;
  states: Array<{
    state_key: string;
    total: number;
    success_count: number;
    error_count: number;
    last_error: string | null;
  }>;
};

export default function Integrations() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [schema, setSchema] = useState<BotSchema | null>(null);
  const [stats, setStats] = useState<WebhookStats | null>(null);
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    if (!id) return;
    void loadInitialData();
  }, [id]);

  const loadInitialData = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const [schemaData, statsData, logsData] = await Promise.all([
        api.getBotSchema(id),
        api.getWebhookStats(id),
        api.getWebhookLogs(id, { limit: 20 }),
      ]);
      setSchema(schemaData.schema);
      setStats(statsData);
      setLogs(logsData.logs as WebhookLog[]);
      setNextCursor(logsData.nextCursor);
      setHasMore(logsData.hasMore);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось загрузить интеграции';
      window.Telegram?.WebApp?.showAlert?.(message);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (!id || loadingMore || !hasMore) return;
    try {
      setLoadingMore(true);
      const data = await api.getWebhookLogs(id, { limit: 20, cursor: nextCursor || undefined });
      setLogs((prev) => [...prev, ...(data.logs as WebhookLog[])]);
      setNextCursor(data.nextCursor);
      setHasMore(data.hasMore);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось загрузить логи';
      window.Telegram?.WebApp?.showAlert?.(message);
    } finally {
      setLoadingMore(false);
    }
  };

  const webhookStates = useMemo(() => {
    if (!schema) return [];
    return Object.entries(schema.states).filter(([, state]) => state.webhook?.enabled);
  }, [schema]);

  if (loading) {
    return (
      <div className="page">
        <div className="empty-state">
          <div className="empty-state-icon">⏳</div>
          <div className="empty-state-text">Загрузка...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page integrations-page">
      <div className="page-header integrations-header">
        <button className="btn btn-secondary" onClick={() => navigate(`/bot/${id}`)}>
          ← Назад
        </button>
        <div>
          <h1 className="page-title">Интеграции</h1>
          <p className="page-subtitle">Webhook и внешние сервисы</p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate(`/bot/${id}`)}>
          Настроить интеграцию
        </button>
      </div>

      <div className="integrations-stats">
        <div className="card">
          <div className="integrations-stat-label">Всего отправок</div>
          <div className="integrations-stat-value">{stats?.total ?? 0}</div>
        </div>
        <div className="card">
          <div className="integrations-stat-label">Успешность</div>
          <div className="integrations-stat-value">
            {stats ? `${Math.round((stats.successRate || 0) * 100)}%` : '0%'}
          </div>
        </div>
        <div className="card">
          <div className="integrations-stat-label">Состояний с webhook</div>
          <div className="integrations-stat-value">{webhookStates.length}</div>
        </div>
      </div>

      <div className="integrations-section">
        <h3>Состояния с webhook</h3>
        {webhookStates.length === 0 ? (
          <div className="empty-hint">Пока нет состояний с включённым webhook</div>
        ) : (
          <div className="integrations-state-list">
            {webhookStates.map(([key, state]) => (
              <div key={key} className="integrations-state-item">
                <div className="integrations-state-key">{key}</div>
                <div className="integrations-state-url">{state.webhook?.url}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="integrations-section">
        <h3>Последние логи webhook</h3>
        {logs.length === 0 ? (
          <div className="empty-hint">Логи пока отсутствуют</div>
        ) : (
          <div className="integrations-logs">
            <div className="integrations-logs-header">
              <span>Состояние</span>
              <span>Status</span>
              <span>User ID</span>
              <span>Время</span>
              <span>Ошибка</span>
            </div>
            {logs.map((log) => (
              <div key={log.id} className="integrations-logs-row">
                <span>{log.state_key}</span>
                <span>{log.response_status ?? '—'}</span>
                <span>{log.telegram_user_id}</span>
                <span>{new Date(log.created_at).toLocaleString()}</span>
                <span>{log.error_message || '—'}</span>
              </div>
            ))}
          </div>
        )}
        {hasMore ? (
          <div style={{ marginTop: '16px', textAlign: 'center' }}>
            <button className="btn btn-secondary" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? 'Загрузка...' : 'Загрузить ещё'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
