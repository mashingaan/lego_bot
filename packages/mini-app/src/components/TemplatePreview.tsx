import { BotTemplate } from '../data/templates';

type TemplatePreviewProps = {
  template: BotTemplate;
  onClose: () => void;
  onUse: () => void;
};

export default function TemplatePreview({ template, onClose, onUse }: TemplatePreviewProps) {
  const states = Object.entries(template.schema.states);
  const transitions = states.flatMap(([stateKey, state]) =>
    (state.buttons ?? []).flatMap((button) => {
      if (button.type === 'url') {
        return [];
      }
      return [
        {
          from: stateKey,
          to: button.nextState,
          label: button.text,
        },
      ];
    })
  );

  return (
    <div className="template-preview-overlay" onClick={onClose}>
      <div className="template-preview" onClick={(event) => event.stopPropagation()}>
        <div className="template-preview-header">
          <div className="template-preview-icon">{template.icon}</div>
          <div>
            <div className="template-preview-title">{template.name}</div>
            <div className="template-preview-subtitle">{template.description}</div>
          </div>
        </div>

        <div className="template-preview-screenshot">
          {template.preview.screenshot ? (
            <img
              src={template.preview.screenshot}
              alt={`Превью шаблона ${template.name}`}
            />
          ) : (
            <div className="template-preview-screenshot-placeholder">Превью отсутствует</div>
          )}
        </div>

        <div className="template-preview-section">
          <div className="template-preview-section-title">Ключевые возможности</div>
          <ul className="template-preview-features">
            {template.preview.features.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        </div>

        <div className="template-preview-section">
          <div className="template-preview-section-title">Состояния</div>
          <div className="template-preview-states">
            {states.map(([stateKey, state]) => (
              <div key={stateKey} className="template-preview-state">
                <div className="template-preview-state-name">{stateKey}</div>
                <div className="template-preview-state-message">{state.message}</div>
                {(state.buttons ?? []).length > 0 ? (
                  <div className="template-preview-state-buttons">
                    {(state.buttons ?? []).map((button) => (
                      <span key={`${stateKey}-${button.text}`} className="template-preview-button">
                        {button.text}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className="template-preview-section">
          <div className="template-preview-section-title">Переходы</div>
          <ul className="template-preview-flow">
            {transitions.length === 0 ? (
              <li>Переходы отсутствуют</li>
            ) : (
              transitions.map((transition, index) => (
                <li key={`${transition.from}-${transition.to}-${index}`}>
                  {transition.from} → {transition.to} ({transition.label})
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="template-preview-actions">
          <button className="btn btn-primary" onClick={onUse}>
            Использовать шаблон
          </button>
          <button className="btn btn-secondary" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
