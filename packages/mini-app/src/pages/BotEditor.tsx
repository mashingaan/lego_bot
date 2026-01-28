import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { BotSchema } from '../types';

const WebApp = window.Telegram?.WebApp;
import SchemaEditor from '../components/SchemaEditor';
import './BotEditor.css';

const DEFAULT_SCHEMA: BotSchema = {
  version: 1,
  initialState: 'start',
  states: {
    start: {
      message: 'Привет! Добро пожаловать!',
      buttons: [],
    },
  },
};

export default function BotEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [schema, setSchema] = useState<BotSchema>(DEFAULT_SCHEMA);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contactsCount, setContactsCount] = useState<number | null>(null);

  useEffect(() => {
    if (id) {
      loadSchema();
      loadContactsStats();
    }
  }, [id]);

  const loadSchema = async () => {
    if (!id) return;

    try {
      setLoading(true);
      setError(null);
      const data = await api.getBotSchema(id);
      setSchema(data.schema || DEFAULT_SCHEMA);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки схемы');
      if (err instanceof Error && err.message.includes('404')) {
        // Схема не найдена, используем дефолтную
        setSchema(DEFAULT_SCHEMA);
        setError(null);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!id) return;

    try {
      setSaving(true);
      setError(null);
      await api.updateBotSchema(id, schema);
      WebApp?.showAlert('Схема успешно сохранена!');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Ошибка сохранения';
      setError(errorMessage);
      WebApp?.showAlert(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const loadContactsStats = async () => {
    if (!id) return;
    try {
      const stats = await api.getBotUserStats(id);
      setContactsCount(stats.total);
    } catch {
      setContactsCount(null);
    }
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

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button className="btn btn-secondary" onClick={() => navigate('/')}>
            ← Назад
          </button>
          <button className="btn btn-secondary" onClick={() => navigate(`/bot/${id}/clients`)}>
            Клиенты
            {contactsCount !== null ? (
              <span className="clients-badge">{contactsCount}</span>
            ) : null}
          </button>
          <button className="btn btn-secondary" onClick={() => navigate(`/bot/${id}/analytics`)}>
            Аналитика
          </button>
          <button className="btn btn-secondary" onClick={() => navigate(`/bot/${id}/integrations`)}>
            Интеграции
          </button>
          <button className="btn btn-secondary" onClick={() => navigate(`/bot/${id}/broadcasts`)}>
            Рассылки
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Сохранение...' : '💾 Сохранить'}
          </button>
        </div>
      </div>

      {error && (
        <div className="error-banner">
          {error}
        </div>
      )}

      <SchemaEditor schema={schema} onChange={setSchema} botId={id} />
    </div>
  );
}


