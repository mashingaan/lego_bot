import { useEffect, useState } from 'react';
import { BotSchema } from '@dialogue-constructor/shared/browser';
import { api } from '../utils/api';
import IntegrationTemplateSelector from './IntegrationTemplateSelector';
import { INTEGRATION_TEMPLATES, IntegrationTemplateDefinition } from '../data/integration-templates';
import './StateEditor.css';

interface StateEditorProps {
  stateKey: string;
  state: BotSchema['states'][string];
  allStates: string[];
  botId?: string;
  onChange: (updates: Partial<BotSchema['states'][string]>) => void;
}

const WebApp = window.Telegram?.WebApp;
const MAX_MEDIA_URL_LENGTH = 2048;

type MediaType = 'photo' | 'video' | 'document' | 'audio';
type MediaGroupItem = {
  type: 'photo' | 'video';
  url: string;
  caption?: string;
};

export default function StateEditor({
  stateKey,
  state,
  allStates,
  botId,
  onChange,
}: StateEditorProps) {
  const [message, setMessage] = useState(state.message);
  type BotButton = NonNullable<BotSchema['states'][string]['buttons']>[number];
  const [buttons, setButtons] = useState<BotButton[]>(state.buttons || []);
  const [mediaEnabled, setMediaEnabled] = useState(Boolean(state.media || state.mediaGroup));
  const [mediaMode, setMediaMode] = useState<'single' | 'group'>(
    state.mediaGroup ? 'group' : 'single'
  );
  const [mediaType, setMediaType] = useState<MediaType>(state.media?.type ?? 'photo');
  const [mediaUrl, setMediaUrl] = useState(state.media?.url ?? '');
  const [mediaCaption, setMediaCaption] = useState(state.media?.caption ?? '');
  const [mediaCover, setMediaCover] = useState(state.media?.cover ?? '');
  const [mediaGroup, setMediaGroup] = useState<MediaGroupItem[]>(state.mediaGroup ?? []);
  const [parseMode, setParseMode] = useState<'HTML' | 'Markdown' | 'MarkdownV2'>(
    state.parseMode ?? 'HTML'
  );

  const [webhookEnabled, setWebhookEnabled] = useState(state.webhook?.enabled ?? false);
  const [webhookUrl, setWebhookUrl] = useState(state.webhook?.url ?? '');
  const [webhookMethod, setWebhookMethod] = useState(state.webhook?.method ?? 'POST');
  const [webhookHeaders, setWebhookHeaders] = useState<Record<string, string>>(
    state.webhook?.headers ?? {}
  );
  const [webhookHeadersText, setWebhookHeadersText] = useState(
    JSON.stringify(state.webhook?.headers ?? {}, null, 2)
  );
  const [webhookTimeout, setWebhookTimeout] = useState(state.webhook?.timeout ?? 10000);
  const [webhookRetryCount, setWebhookRetryCount] = useState<number | undefined>(
    state.webhook?.retryCount
  );
  const [webhookSigningSecret, setWebhookSigningSecret] = useState(
    state.webhook?.signingSecret ?? ''
  );
  const [integrationType, setIntegrationType] = useState<IntegrationTemplateDefinition['id']>(
    state.integration?.type ?? 'custom'
  );
  const [integrationConfig, setIntegrationConfig] = useState<Record<string, any>>(
    state.integration?.config ?? {}
  );

  useEffect(() => {
    setMessage(state.message);
    setButtons(state.buttons || []);
    setMediaEnabled(Boolean(state.media || state.mediaGroup));
    setMediaMode(state.mediaGroup ? 'group' : 'single');
    setMediaType(state.media?.type ?? 'photo');
    setMediaUrl(state.media?.url ?? '');
    setMediaCaption(state.media?.caption ?? '');
    setMediaCover(state.media?.cover ?? '');
    setMediaGroup(state.mediaGroup ?? []);
    setParseMode(state.parseMode ?? 'HTML');
    setWebhookEnabled(state.webhook?.enabled ?? false);
    setWebhookUrl(state.webhook?.url ?? '');
    setWebhookMethod(state.webhook?.method ?? 'POST');
    setWebhookHeaders(state.webhook?.headers ?? {});
    setWebhookHeadersText(JSON.stringify(state.webhook?.headers ?? {}, null, 2));
    setWebhookTimeout(state.webhook?.timeout ?? 10000);
    setWebhookRetryCount(state.webhook?.retryCount);
    setWebhookSigningSecret(state.webhook?.signingSecret ?? '');
    setIntegrationType(state.integration?.type ?? 'custom');
    setIntegrationConfig(state.integration?.config ?? {});
  }, [state]);

  const syncWebhook = (overrides: Partial<NonNullable<BotSchema['states'][string]['webhook']>> = {}) => {
    const nextWebhook: NonNullable<BotSchema['states'][string]['webhook']> = {
      url: webhookUrl,
      enabled: webhookEnabled,
      method: webhookMethod,
      headers: webhookHeaders,
      signingSecret: webhookSigningSecret || undefined,
      timeout: webhookTimeout,
      ...overrides,
    };
    const nextRetryCount =
      'retryCount' in overrides ? overrides.retryCount : webhookRetryCount;
    if (nextRetryCount === undefined || nextRetryCount === null) {
      delete (nextWebhook as { retryCount?: number }).retryCount;
    } else {
      (nextWebhook as { retryCount?: number }).retryCount = nextRetryCount;
    }
    onChange({ webhook: nextWebhook });
  };

  const handleMessageChange = (newMessage: string) => {
    setMessage(newMessage);
    onChange({ message: newMessage });
  };

  const syncMediaState = (overrides: Partial<BotSchema['states'][string]> = {}) => {
    if (!mediaEnabled) {
      onChange({ media: undefined, mediaGroup: undefined, ...overrides });
      return;
    }

    if (mediaMode === 'group') {
      onChange({ media: undefined, mediaGroup: mediaGroup.length > 0 ? mediaGroup : [], ...overrides });
      return;
    }

    const mediaPayload = {
      type: mediaType,
      url: mediaUrl,
      caption: mediaCaption || undefined,
      cover: mediaType === 'video' ? mediaCover || undefined : undefined,
    };
    onChange({ media: mediaPayload, mediaGroup: undefined, ...overrides });
  };

  const handleMediaToggle = (enabled: boolean) => {
    setMediaEnabled(enabled);
    if (!enabled) {
      onChange({ media: undefined, mediaGroup: undefined });
      return;
    }
    syncMediaState();
  };

  const handleMediaModeChange = (mode: 'single' | 'group') => {
    setMediaMode(mode);
    if (!mediaEnabled) {
      return;
    }
    if (mode === 'group') {
      onChange({ media: undefined, mediaGroup: mediaGroup.length > 0 ? mediaGroup : [] });
    } else {
      const mediaPayload = {
        type: mediaType,
        url: mediaUrl,
        caption: mediaCaption || undefined,
        cover: mediaType === 'video' ? mediaCover || undefined : undefined,
      };
      onChange({ media: mediaPayload, mediaGroup: undefined });
    }
  };

  const handleMediaTypeChange = (type: MediaType) => {
    setMediaType(type);
    syncMediaState();
  };

  const handleMediaUrlChange = (url: string) => {
    if (url.length > MAX_MEDIA_URL_LENGTH) {
      WebApp?.showAlert?.('Слишком длинный URL (макс. 2048 символов).');
      return;
    }
    if (url && !url.startsWith('https://')) {
      WebApp?.showAlert?.('URL должен начинаться с https://');
      return;
    }
    setMediaUrl(url);
    syncMediaState();
  };

  const handleMediaCaptionChange = (value: string) => {
    setMediaCaption(value);
    syncMediaState();
  };

  const handleMediaCoverChange = (value: string) => {
    if (value && !value.startsWith('https://')) {
      WebApp?.showAlert?.('URL должен начинаться с https://');
      return;
    }
    setMediaCover(value);
    syncMediaState();
  };

  const handleAddMediaGroupItem = () => {
    if (mediaGroup.length >= 10) {
      WebApp?.showAlert?.('Максимум 10 элементов в media group.');
      return;
    }
    const next: MediaGroupItem[] = [...mediaGroup, { type: 'photo', url: '', caption: '' }];
    setMediaGroup(next);
    onChange({ media: undefined, mediaGroup: next });
  };

  const handleMediaGroupItemChange = (index: number, updates: Partial<MediaGroupItem>) => {
    if (updates.url) {
      if (updates.url.length > MAX_MEDIA_URL_LENGTH) {
        WebApp?.showAlert?.('Слишком длинный URL (макс. 2048 символов).');
        return;
      }
      if (!updates.url.startsWith('https://')) {
        WebApp?.showAlert?.('URL должен начинаться с https://');
        return;
      }
    }
    const next: MediaGroupItem[] = mediaGroup.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...updates } : item
    );
    setMediaGroup(next);
    onChange({ media: undefined, mediaGroup: next });
  };

  const handleRemoveMediaGroupItem = (index: number) => {
    const next = mediaGroup.filter((_item, itemIndex) => itemIndex !== index);
    setMediaGroup(next);
    onChange({ media: undefined, mediaGroup: next.length > 0 ? next : [] });
  };

  const handleParseModeChange = (mode: 'HTML' | 'Markdown' | 'MarkdownV2') => {
    setParseMode(mode);
    onChange({ parseMode: mode });
  };

  const handleButtonTextChange = (index: number, text: string) => {
    const newButtons = [...buttons];
    newButtons[index] = { ...newButtons[index], text };
    setButtons(newButtons);
    onChange({ buttons: newButtons });
  };

  const handleButtonNextStateChange = (index: number, nextState: string) => {
    const newButtons = [...buttons];
    const current = newButtons[index];
    if (current.type === 'url') {
      return;
    }
    newButtons[index] = { ...current, nextState };
    setButtons(newButtons);
    onChange({ buttons: newButtons });
  };

  const handleButtonUrlChange = (index: number, url: string) => {
    if (url.length > MAX_MEDIA_URL_LENGTH) {
      WebApp?.showAlert?.('Слишком длинный URL (макс. 2048 символов).');
      return;
    }
    if (url && !url.startsWith('https://')) {
      WebApp?.showAlert?.('URL должен начинаться с https://');
      return;
    }
    const newButtons = [...buttons];
    const current = newButtons[index];
    if (current.type !== 'url') {
      return;
    }
    newButtons[index] = { ...current, url };
    setButtons(newButtons);
    onChange({ buttons: newButtons });
  };

  const handleButtonTypeChange = (index: number, type: 'navigation' | 'request_contact' | 'request_email' | 'url') => {
    const newButtons = [...buttons];
    const existingRequestButtonIndex = newButtons.findIndex(
      (button, buttonIndex) =>
        ((button as any).type === 'request_contact' || (button as any).type === 'request_email') && buttonIndex !== index
    );

    if ((type === 'request_contact' || type === 'request_email') && existingRequestButtonIndex !== -1) {
      WebApp?.showAlert?.('В одном состоянии может быть только одна кнопка запроса телефона или email.');
      return;
    }

    const nextState = (newButtons[index] as any).nextState || allStates[0] || stateKey;
    const text =
      type === 'request_contact'
        ? '📱 Поделиться номером'
        : type === 'request_email'
          ? '✉️ Поделиться email'
          : type === 'url'
            ? 'Открыть ссылку'
            : (newButtons[index] as any).text;
    if (type === 'url') {
      newButtons[index] = {
        type,
        text,
        url: (newButtons[index] as any).url || 'https://',
      };
    } else {
      newButtons[index] = {
        type,
        text,
        nextState,
      };
    }
    setButtons(newButtons);
    onChange({ buttons: newButtons });
  };

  const handleAddButton = () => {
    const newButton: BotButton = {
      type: 'navigation',
      text: 'Новая кнопка',
      nextState: allStates[0] || stateKey,
    };
    const newButtons = [...buttons, newButton];
    setButtons(newButtons);
    onChange({ buttons: newButtons });
  };

  const handleDeleteButton = (index: number) => {
    const newButtons = buttons.filter((_button: typeof buttons[0], i: number) => i !== index);
    setButtons(newButtons);
    onChange({ buttons: newButtons.length > 0 ? newButtons : undefined });
  };

  const handleWebhookToggle = (enabled: boolean) => {
    setWebhookEnabled(enabled);
    syncWebhook({ enabled });
  };

  const handleWebhookUrlChange = (url: string) => {
    setWebhookUrl(url);
    syncWebhook({ url });
  };

  const handleWebhookMethodChange = (method: 'POST' | 'GET') => {
    setWebhookMethod(method);
    syncWebhook({ method });
  };

  const handleWebhookSigningSecretChange = (secret: string) => {
    setWebhookSigningSecret(secret);
    syncWebhook({ signingSecret: secret || undefined });
  };

  const handleWebhookTimeoutChange = (value: number) => {
    setWebhookTimeout(value);
    syncWebhook({ timeout: value });
  };

  const handleWebhookRetryCountChange = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setWebhookRetryCount(undefined);
      syncWebhook({ retryCount: undefined });
      return;
    }
    const parsed = Number(trimmed);
    if (Number.isNaN(parsed)) {
      return;
    }
    setWebhookRetryCount(parsed);
    syncWebhook({ retryCount: parsed });
  };

  const handleWebhookHeadersChange = (value: string) => {
    setWebhookHeadersText(value);
    try {
      const parsed = value.trim().length === 0 ? {} : JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return;
      }
      const normalized = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>)
          .filter(([key]) => typeof key === 'string' && key.length > 0)
          .map(([key, val]) => [key, typeof val === 'string' ? val : JSON.stringify(val)])
      ) as Record<string, string>;
      setWebhookHeaders(normalized);
      syncWebhook({ headers: normalized });
    } catch {
      // ignore parse errors
    }
  };

  const handleIntegrationTemplateSelect = (templateId: IntegrationTemplateDefinition['id']) => {
    const template = INTEGRATION_TEMPLATES.find((item) => item.id === templateId);
    if (!template) return;

    const templateUrl = (template.config as any).spreadsheetUrl ?? (template.config as any).webhookUrl ?? webhookUrl;
    setIntegrationType(template.id);
    setIntegrationConfig(template.config);
    onChange({ integration: { type: template.id, config: template.config } });

    if (!webhookEnabled) {
      setWebhookEnabled(true);
    }
    if (templateUrl && templateUrl !== webhookUrl) {
      setWebhookUrl(templateUrl);
      syncWebhook({ enabled: true, url: templateUrl });
    } else {
      syncWebhook({ enabled: true });
    }
  };

  const handleTestWebhook = async () => {
    if (!botId) {
      WebApp?.showAlert?.('Сначала сохраните бота, чтобы протестировать webhook.');
      return;
    }
    if (!webhookEnabled || !webhookUrl) {
      WebApp?.showAlert?.('Сначала включите webhook и укажите URL.');
      return;
    }

    try {
      const result = await api.testWebhook(botId, stateKey);
      WebApp?.showAlert?.(
        result.success
          ? `Webhook успешно отправлен (status ${result.status}).`
          : `Webhook ответил со статусом ${result.status}.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ошибка тестового webhook';
      WebApp?.showAlert?.(message);
    }
  };

  return (
    <div className="state-editor">
      <h3>Редактирование: {stateKey}</h3>

      <div className="editor-field">
        <label>Сообщение</label>
        <textarea
          className="textarea"
          value={message}
          onChange={(e) => handleMessageChange(e.target.value)}
          placeholder="Введите текст сообщения"
        />
      </div>

      <div className="editor-field">
        <label>Медиа контент</label>
        <div className="media-section">
          <label className="media-toggle">
            <input
              type="checkbox"
              checked={mediaEnabled}
              onChange={(e) => handleMediaToggle(e.target.checked)}
            />
            Добавить медиа
          </label>

          {mediaEnabled ? (
            <>
              <select
                className="input"
                value={mediaMode}
                onChange={(e) => handleMediaModeChange(e.target.value as 'single' | 'group')}
              >
                <option value="single">Один медиа файл</option>
                <option value="group">Media Group (карусель)</option>
              </select>

              {mediaMode === 'single' ? (
                <div className="media-fields">
                  <select
                    className="input"
                    value={mediaType}
                    onChange={(e) => handleMediaTypeChange(e.target.value as MediaType)}
                  >
                    <option value="photo">Photo</option>
                    <option value="video">Video</option>
                    <option value="document">Document</option>
                    <option value="audio">Audio</option>
                  </select>
                  <input
                    className="input"
                    type="text"
                    value={mediaUrl}
                    onChange={(e) => handleMediaUrlChange(e.target.value)}
                    placeholder="https://example.com/media"
                  />
                  <input
                    className="input"
                    type="text"
                    value={mediaCaption}
                    onChange={(e) => handleMediaCaptionChange(e.target.value)}
                    placeholder="Caption (опционально)"
                  />
                  <div className="media-hint">
                    Если caption пустой, будет использован текст сообщения как подпись.
                  </div>
                  {mediaType === 'video' ? (
                    <>
                      <input
                        className="input"
                        type="text"
                        value={mediaCover}
                        onChange={(e) => handleMediaCoverChange(e.target.value)}
                        placeholder="Cover URL (опционально, URL/file_id)"
                      />
                      <div className="media-hint">
                        Обложка видео (cover) поддерживает URL/file_id. Thumbnail — только multipart (attach://...), в URL-режиме игнорируется.
                      </div>
                    </>
                  ) : null}
                  {mediaUrl ? (
                    <div className="media-preview">
                      {mediaType === 'photo' ? (
                        <img src={mediaUrl} alt="preview" />
                      ) : mediaType === 'video' ? (
                        <video src={mediaUrl} controls />
                      ) : (
                        <div className="media-hint">Предпросмотр доступен только для фото/видео</div>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="media-group">
                  <div className="media-hint">2–10 элементов в Media Group</div>
                  {mediaGroup.length > 0 && mediaGroup.length < 2 ? (
                    <div className="media-hint">Добавьте минимум 2 элемента</div>
                  ) : null}
                  <div className="media-group-list">
                    {mediaGroup.map((item, index) => (
                      <div key={index} className="media-group-item">
                        <select
                          className="input"
                          value={item.type}
                          onChange={(e) =>
                            handleMediaGroupItemChange(index, { type: e.target.value as 'photo' | 'video' })
                          }
                        >
                          <option value="photo">Photo</option>
                          <option value="video">Video</option>
                        </select>
                        <input
                          className="input"
                          type="text"
                          value={item.url}
                          onChange={(e) => handleMediaGroupItemChange(index, { url: e.target.value })}
                          placeholder="https://example.com/media"
                        />
                        <input
                          className="input"
                          type="text"
                          value={item.caption || ''}
                          onChange={(e) => handleMediaGroupItemChange(index, { caption: e.target.value })}
                          placeholder="Caption (опционально)"
                        />
                        <button className="btn btn-danger btn-small" onClick={() => handleRemoveMediaGroupItem(index)}>
                          Удалить
                        </button>
                        {item.url ? (
                          <div className="media-preview">
                            {item.type === 'photo' ? (
                              <img src={item.url} alt="preview" />
                            ) : (
                              <video src={item.url} controls />
                            )}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <button className="btn btn-secondary btn-small" onClick={handleAddMediaGroupItem}>
                    + Добавить элемент
                  </button>
                  <div className="media-hint">
                    Сообщение будет отправлено отдельным текстом до/после альбома.
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>

      <div className="editor-field">
        <label>Форматирование</label>
        <div className="format-section">
          <select
            className="input"
            value={parseMode}
            onChange={(e) => handleParseModeChange(e.target.value as 'HTML' | 'Markdown' | 'MarkdownV2')}
          >
            <option value="HTML">HTML</option>
            <option value="Markdown">
              Markdown
            </option>
            <option value="MarkdownV2">
              MarkdownV2
            </option>
          </select>
          <div className="format-hint">
            HTML: &lt;b&gt;жирный&lt;/b&gt;, &lt;i&gt;курсив&lt;/i&gt;, &lt;a href="https://..."&gt;ссылка&lt;/a&gt;
          </div>
        </div>
      </div>

      <div className="editor-field">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <label>Кнопки</label>
          <button className="btn btn-secondary btn-small" onClick={handleAddButton}>
            + Добавить кнопку
          </button>
        </div>

        {buttons.length === 0 ? (
          <div className="empty-hint">Нет кнопок</div>
        ) : (
          <div className="buttons-list">
            {buttons.map((button: typeof buttons[0], index: number) => (
              <div key={index} className="button-editor">
                <select
                  className="input button-type-selector"
                  value={(button as any).type || 'navigation'}
                  onChange={(e) =>
                    handleButtonTypeChange(index, e.target.value as 'navigation' | 'request_contact' | 'request_email' | 'url')
                  }
                >
                  <option value="navigation">Обычная кнопка</option>
                  <option value="url">URL кнопка</option>
                  <option value="request_contact">Запросить телефон</option>
                  <option value="request_email">Запросить email (вводом)</option>
                </select>
                <input
                  className="input"
                  type="text"
                  value={button.text}
                  onChange={(e) => handleButtonTextChange(index, e.target.value)}
                  placeholder="Текст кнопки"
                />
                {(button as any).type === 'url' ? (
                  <div className="button-url">
                    <input
                      className="input"
                      type="text"
                      value={(button as any).url || ''}
                      onChange={(e) => handleButtonUrlChange(index, e.target.value)}
                      placeholder="https://example.com"
                    />
                    <div className="button-hint">URL кнопки открывают ссылку в браузере</div>
                  </div>
                ) : (button as any).type !== 'request_contact' && (button as any).type !== 'request_email' ? (
                  <select
                    className="input"
                    value={'nextState' in button ? button.nextState : allStates[0] || stateKey}
                    onChange={(e) => handleButtonNextStateChange(index, e.target.value)}
                  >
                    {allStates.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="button-hint">
                    {(button as any).type === 'request_contact'
                      ? 'Пользователь поделится номером телефона'
                      : 'Пользователь введёт email следующим сообщением'}
                  </div>
                )}
                <button
                  className="btn btn-danger btn-small"
                  onClick={() => handleDeleteButton(index)}
                >
                  Удалить
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="editor-field">
        <label>Интеграции</label>
        <div className="integration-section">
          <label className="integration-toggle">
            <input
              type="checkbox"
              checked={webhookEnabled}
              onChange={(e) => handleWebhookToggle(e.target.checked)}
            />
            Включить webhook при переходе в это состояние
          </label>

          <input
            className="input"
            type="text"
            value={webhookUrl}
            onChange={(e) => handleWebhookUrlChange(e.target.value)}
            placeholder="https://your-webhook-endpoint"
            disabled={!webhookEnabled}
          />

          <div className="integration-actions">
            <button
              className="btn btn-secondary btn-small"
              onClick={handleTestWebhook}
              disabled={!webhookEnabled || !webhookUrl}
            >
              Тестировать webhook
            </button>
          </div>

          <label>Шаблон интеграции</label>
          <select
            className="input"
            value={integrationType}
            onChange={(e) => handleIntegrationTemplateSelect(e.target.value as IntegrationTemplateDefinition['id'])}
          >
            {INTEGRATION_TEMPLATES.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>

          <IntegrationTemplateSelector
            selectedId={integrationType}
            onApply={(template) => handleIntegrationTemplateSelect(template.id)}
          />

          <div className="integration-settings">
            <div className="integration-setting">
              <label>Метод</label>
              <select
                className="input"
                value={webhookMethod}
                onChange={(e) => handleWebhookMethodChange(e.target.value as 'POST' | 'GET')}
              >
                <option value="POST">POST</option>
                <option value="GET">GET</option>
              </select>
            </div>
            <div className="integration-setting">
              <label>Headers (JSON)</label>
              <textarea
                className="textarea"
                value={webhookHeadersText}
                onChange={(e) => handleWebhookHeadersChange(e.target.value)}
                placeholder='{"Authorization": "Bearer token"}'
              />
            </div>
            <div className="integration-setting">
              <label>Signing secret</label>
              <input
                className="input"
                type="text"
                value={webhookSigningSecret}
                onChange={(e) => handleWebhookSigningSecretChange(e.target.value)}
                placeholder="secret"
              />
            </div>
            <div className="integration-setting">
              <label>Timeout (ms)</label>
              <input
                className="input"
                type="number"
                min={1000}
                value={webhookTimeout}
                onChange={(e) => handleWebhookTimeoutChange(Number(e.target.value))}
              />
            </div>
            <div className="integration-setting">
              <label>Retry count</label>
              <input
                className="input"
                type="number"
                min={0}
                value={webhookRetryCount ?? ''}
                placeholder="по умолчанию"
                onChange={(e) => handleWebhookRetryCountChange(e.target.value)}
              />
            </div>
          </div>

          {integrationConfig && Object.keys(integrationConfig).length > 0 ? (
            <div className="integration-config-preview">
              <div className="integration-config-title">Текущая конфигурация шаблона</div>
              <pre>{JSON.stringify(integrationConfig, null, 2)}</pre>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
