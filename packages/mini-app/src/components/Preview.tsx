import { useState, useEffect } from 'react';
import { BotSchema } from '@dialogue-constructor/shared/browser';
import './Preview.css';

interface PreviewProps {
  schema: BotSchema;
}

export default function Preview({ schema }: PreviewProps) {
  const [currentState, setCurrentState] = useState<string>(schema.initialState);

  useEffect(() => {
    setCurrentState(schema.initialState);
  }, [schema.initialState]);

  const state = schema.states[currentState];

  const handleButtonClick = (nextState: string) => {
    if (schema.states[nextState]) {
      setCurrentState(nextState);
    }
  };

  const handleReset = () => {
    setCurrentState(schema.initialState);
  };

  return (
    <div className="preview">
      <div className="preview-header">
        <h3>Предпросмотр бота</h3>
        <button className="btn btn-secondary btn-small" onClick={handleReset}>
          Сбросить
        </button>
      </div>

      <div className="preview-chat">
        <div className="chat-message">
          <div className="message-bubble">{state?.message || 'Нет сообщения'}</div>
        </div>

        {state?.buttons && state.buttons.length > 0 && (
          <div className="chat-buttons">
            {state.buttons.map((button, index) => (
              <button
                key={index}
                className="preview-button"
                onClick={() => {
                  if (button.type === 'url') {
                    return;
                  }
                  handleButtonClick(button.nextState);
                }}
              >
                {button.text}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="preview-info">
        <div className="info-item">
          <span className="info-label">Текущее состояние:</span>
          <span className="info-value">{currentState}</span>
        </div>
        <div className="info-item">
          <span className="info-label">Всего состояний:</span>
          <span className="info-value">{Object.keys(schema.states).length}</span>
        </div>
        <div className="info-item">
          <span className="info-label">Начальное состояние:</span>
          <span className="info-value">{schema.initialState}</span>
        </div>
      </div>
    </div>
  );
}


