import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UpdateBotSchemaSchema } from '@dialogue-constructor/shared/browser';
import { api } from '../utils/api';
import { getTemplates, BotTemplate } from '../data/templates';
import TemplatePreview from '../components/TemplatePreview';
import './Templates.css';

const WebApp = window.Telegram?.WebApp;

const CATEGORY_TABS = [
  { key: 'all', label: 'Все' },
  { key: 'business', label: 'Бизнес' },
  { key: 'education', label: 'Образование' },
  { key: 'entertainment', label: 'Развлечения' },
] as const;

const CATEGORY_LABELS: Record<BotTemplate['category'], string> = {
  business: 'Бизнес',
  education: 'Образование',
  entertainment: 'Развлечения',
  other: 'Другое',
};

type CategoryKey = (typeof CATEGORY_TABS)[number]['key'];

function showConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (WebApp?.showConfirm) {
      WebApp.showConfirm(message, (confirmed) => resolve(Boolean(confirmed)));
      return;
    }
    resolve(window.confirm(message));
  });
}

function showAlert(message: string) {
  if (WebApp?.showAlert) {
    WebApp.showAlert(message);
    return;
  }
  window.alert(message);
}

export default function Templates() {
  const navigate = useNavigate();
  const [activeCategory, setActiveCategory] = useState<CategoryKey>('all');
  const [selectedTemplate, setSelectedTemplate] = useState<BotTemplate | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [templates, setTemplates] = useState<BotTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);

  const filteredTemplates = useMemo(() => {
    if (activeCategory === 'all') {
      return templates;
    }
    return templates.filter((template) => template.category === activeCategory);
  }, [activeCategory, templates]);

  useEffect(() => {
    let isMounted = true;

    const loadTemplates = async () => {
      try {
        const loadedTemplates = await getTemplates();
        for (const template of loadedTemplates) {
          const validation = UpdateBotSchemaSchema.safeParse(template.schema);
          if (!validation.success) {
            const errors = validation.error.errors.map((err) => err.message);
            console.warn('Template schema validation failed:', {
              templateId: template.id,
              errors: errors,
            });
            showAlert(`Шаблон "${template.name}" содержит ошибки: ${errors.join(', ')}`);
          }
        }
        if (isMounted) {
          setTemplates(loadedTemplates);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Не удалось загрузить шаблоны';
        showAlert(message);
      } finally {
        if (isMounted) {
          setLoadingTemplates(false);
        }
      }
    };

    loadTemplates();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleTemplateSelect = async (template: BotTemplate) => {
    const confirmed = await showConfirm(`Создать бота '${template.name}'?`);
    if (!confirmed) {
      return;
    }

    const validation = UpdateBotSchemaSchema.safeParse(template.schema);
    if (!validation.success) {
      const errors = validation.error.errors.map((err) => err.message);
      showAlert(`Шаблон содержит ошибки: ${errors.join(', ')}`);
      return;
    }

    setSelectedTemplate(null);
    setIsCreating(true);

    try {
      const createdBot = await api.createBot(template.name, template.schema);
      showAlert(`Бот "${createdBot.name}" создан`);
      navigate(`/bot/${createdBot.id}`);
    } catch (error) {
      const status = (error as any)?.status;
      let message = 'Не удалось создать бота. Попробуйте позже.';

      if (status === 429) {
        message = 'Достигнут лимит ботов. Удалите один из ботов и попробуйте снова.';
      } else if (error instanceof Error) {
        if (/failed to fetch|network|timeout/i.test(error.message)) {
          message = 'Ошибка сети. Проверьте подключение и попробуйте снова.';
        } else if (error.message) {
          message = error.message;
        }
      }

      showAlert(message);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Шаблоны</h1>
        <p className="page-subtitle">Выберите готовый шаблон и создайте бота за минуту</p>
      </div>

      <div className="templates-tabs">
        {CATEGORY_TABS.map((tab) => (
          <button
            key={tab.key}
            className={`templates-tab ${activeCategory === tab.key ? 'is-active' : ''}`}
            onClick={() => setActiveCategory(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isCreating ? (
        <div className="card">Создаем бота по выбранному шаблону...</div>
      ) : null}

      {loadingTemplates ? (
        <div className="card">Загружаем шаблоны...</div>
      ) : null}

      {filteredTemplates.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📌</div>
          <div className="empty-state-text">Шаблоны этой категории пока не добавлены</div>
        </div>
      ) : null}

      {filteredTemplates.map((template) => (
        <div
          key={template.id}
          className="card template-card"
          onClick={() => setSelectedTemplate(template)}
        >
          <div className="template-card-header">
            <div className="template-card-icon">{template.icon}</div>
            <div>
              <div className="template-card-title">{template.name}</div>
              <div className="template-card-description">{template.description}</div>
              <span className={`template-badge template-badge--${template.category}`}>
                {CATEGORY_LABELS[template.category]}
              </span>
            </div>
          </div>

          <div className="template-card-meta">
            <span>Состояний: {Object.keys(template.schema.states).length}</span>
          </div>

          <ul className="template-features">
            {template.preview.features.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        </div>
      ))}

      {selectedTemplate ? (
        <TemplatePreview
          template={selectedTemplate}
          onClose={() => setSelectedTemplate(null)}
          onUse={() => handleTemplateSelect(selectedTemplate)}
        />
      ) : null}
    </div>
  );
}
