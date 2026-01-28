import { useState } from 'react';
import { BotSchema } from '@dialogue-constructor/shared/browser';
import StateEditor from './StateEditor';
import Preview from './Preview';
import './SchemaEditor.css';

interface SchemaEditorProps {
  schema: BotSchema;
  onChange: (schema: BotSchema) => void;
  botId?: string;
}

export default function SchemaEditor({ schema, onChange, botId }: SchemaEditorProps) {
  const [selectedState, setSelectedState] = useState<string>(schema.initialState);
  const [isPreviewMode, setIsPreviewMode] = useState(false);

  const handleStateChange = (stateKey: string, updates: Partial<BotSchema['states'][string]>) => {
    const newSchema: BotSchema = {
      ...schema,
      states: {
        ...schema.states,
        [stateKey]: {
          ...schema.states[stateKey],
          ...updates,
        },
      },
    };
    onChange(newSchema);
  };

  const handleAddState = () => {
    const newStateKey = `state_${Date.now()}`;
    const newSchema: BotSchema = {
      ...schema,
      states: {
        ...schema.states,
        [newStateKey]: {
          message: 'Новое сообщение',
        },
      },
    };
    onChange(newSchema);
    setSelectedState(newStateKey);
  };

  const handleDeleteState = (stateKey: string) => {
    if (Object.keys(schema.states).length === 1) {
      alert('Нельзя удалить последнее состояние');
      return;
    }

    if (schema.initialState === stateKey) {
      const otherStates = Object.keys(schema.states).filter((k) => k !== stateKey);
      if (otherStates.length > 0) {
        const newSchema: BotSchema = {
          ...schema,
          initialState: otherStates[0],
          states: Object.fromEntries(
            Object.entries(schema.states).filter(([k]) => k !== stateKey)
          ),
        };
        onChange(newSchema);
        setSelectedState(otherStates[0]);
      }
    } else {
      const newSchema: BotSchema = {
        ...schema,
        states: Object.fromEntries(
          Object.entries(schema.states).filter(([k]) => k !== stateKey)
        ),
      };
      onChange(newSchema);
    }
  };

  const handleSetInitialState = (stateKey: string) => {
    onChange({
      ...schema,
      initialState: stateKey,
    });
  };

  if (isPreviewMode) {
    return (
      <div className="schema-editor">
        <div className="editor-header">
          <button className="btn btn-secondary" onClick={() => setIsPreviewMode(false)}>
            ← Редактировать
          </button>
        </div>
        <Preview schema={schema} />
      </div>
    );
  }

  return (
    <div className="schema-editor">
      <div className="editor-header">
        <button className="btn btn-primary" onClick={handleAddState}>
          + Добавить состояние
        </button>
        <button className="btn btn-secondary" onClick={() => setIsPreviewMode(true)}>
          Предпросмотр
        </button>
      </div>

      <div className="editor-content">
        <div className="states-list">
          <h3>Состояния</h3>
          {Object.keys(schema.states).map((stateKey) => (
            <div
              key={stateKey}
              className={`state-item ${selectedState === stateKey ? 'active' : ''}`}
              onClick={() => setSelectedState(stateKey)}
            >
              <div className="state-header">
                <span className="state-name">
                  {stateKey === schema.initialState && '⭐ '}
                  {stateKey}
                </span>
                <div className="state-actions">
                  {stateKey !== schema.initialState && (
                    <button
                      className="btn-small"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSetInitialState(stateKey);
                      }}
                    >
                      Сделать начальным
                    </button>
                  )}
                  <button
                    className="btn-small btn-danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteState(stateKey);
                    }}
                  >
                    Удалить
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="state-editor-container">
          {selectedState && schema.states[selectedState] && (
            <StateEditor
              stateKey={selectedState}
              state={schema.states[selectedState]}
              allStates={Object.keys(schema.states)}
              botId={botId}
              onChange={(updates) => handleStateChange(selectedState, updates)}
            />
          )}
        </div>
      </div>
    </div>
  );
}


