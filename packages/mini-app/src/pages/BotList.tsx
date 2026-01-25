import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { BotSummary } from '../types';

const WebApp = window.Telegram?.WebApp;

type BotsPagination = {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export default function BotList() {
  const navigate = useNavigate();
  const [bots, setBots] = useState<BotSummary[]>([]);
  const [pagination, setPagination] = useState<BotsPagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadBots();
  }, []);

  const loadBots = async () => {
    try {
      setLoading(true);
      setError(null);
      console.log('🔄 Loading bots...');
      const data = await api.getBots();
      console.log('✅ Bots loaded:', data);
      setBots(data.bots);
      setPagination(data.pagination);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Ошибка загрузки ботов';
      console.error('❌ Error loading bots:', err);
      setError(errorMessage);
      WebApp?.showAlert(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (!pagination || loadingMore) {
      return;
    }

    try {
      setLoadingMore(true);
      const nextOffset = pagination.offset + pagination.limit;
      const data = await api.getBots({ offset: nextOffset, limit: pagination.limit });
      setBots((prev) => [...prev, ...data.bots]);
      setPagination(data.pagination);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Ошибка загрузки ботов';
      console.error('❌ Error loading more bots:', err);
      WebApp?.showAlert(errorMessage);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleBotClick = (botId: string) => {
    navigate(`/bot/${botId}`);
  };

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

  if (error) {
    return (
      <div className="page">
        <div className="empty-state">
          <div className="empty-state-icon">❌</div>
          <div className="empty-state-text">{error}</div>
          <button className="btn btn-primary" onClick={loadBots} style={{ marginTop: '16px' }}>
            Повторить
          </button>
        </div>
      </div>
    );
  }

  if (bots.length === 0) {
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Мои боты</h1>
          <p className="page-subtitle">Создайте бота через основного бота</p>
        </div>
        <div className="empty-state">
          <div className="empty-state-icon">🤖</div>
          <div className="empty-state-text">У вас пока нет ботов</div>
          <div className="empty-state-hint">
            Создайте бота через команду /create_bot в основном боте
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Мои боты</h1>
        <p className="page-subtitle">{bots.length} ботов</p>
      </div>
      
      {bots.map((bot) => (
        <div
          key={bot.id}
          className="card"
          onClick={() => handleBotClick(bot.id)}
          style={{ cursor: 'pointer' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '4px' }}>
                {bot.name}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--tg-theme-hint-color)', marginBottom: '8px' }}>
                ID: {bot.id.substring(0, 8)}...
              </div>
              <div style={{ fontSize: '12px', color: 'var(--tg-theme-hint-color)' }}>
                Версия схемы: {bot.schema_version}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end' }}>
              {bot.webhook_set ? (
                <span style={{ fontSize: '12px', color: '#10b981', fontWeight: '500' }}>
                  ✅ Webhook
                </span>
              ) : (
                <span style={{ fontSize: '12px', color: '#ef4444', fontWeight: '500' }}>
                  ❌ Webhook
                </span>
              )}
              <span style={{ fontSize: '10px', color: 'var(--tg-theme-hint-color)' }}>
                →
              </span>
            </div>
          </div>
        </div>
      ))}
      {pagination?.hasMore ? (
        <div style={{ marginTop: '16px', textAlign: 'center' }}>
          <button className="btn btn-primary" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Загрузка...' : 'Показать еще'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

