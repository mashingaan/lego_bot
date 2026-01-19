import { useState, useEffect } from 'react';
import { BotSchema } from '@dialogue-constructor/shared';
import './StateEditor.css';

interface StateEditorProps {
  stateKey: string;
  state: BotSchema['states'][string];
  allStates: string[];
  onChange: (updates: Partial<BotSchema['states'][string]>) => void;
}

export default function StateEditor({
  stateKey,
  state,
  allStates,
  onChange,
}: StateEditorProps) {
  const [message, setMessage] = useState(state.message);
  const [buttons, setButtons] = useState(state.buttons || []);

  useEffect(() => {
    setMessage(state.message);
    setButtons(state.buttons || []);
  }, [state]);

  const handleMessageChange = (newMessage: string) => {
    setMessage(newMessage);
    onChange({ message: newMessage });
  };

  const handleButtonTextChange = (index: number, text: string) => {
    const newButtons = [...buttons];
    newButtons[index] = { ...newButtons[index], text };
    setButtons(newButtons);
    onChange({ buttons: newButtons });
  };

  const handleButtonNextStateChange = (index: number, nextState: string) => {
    const newButtons = [...buttons];
    newButtons[index] = { ...newButtons[index], nextState };
    setButtons(newButtons);
    onChange({ buttons: newButtons });
  };

  const handleAddButton = () => {
    const newButtons = [
      ...buttons,
      {
        text: 'Новая кнопка',
        nextState: allStates[0] || stateKey,
      },
    ];
    setButtons(newButtons);
    onChange({ buttons: newButtons });
  };

  const handleDeleteButton = (index: number) => {
    const newButtons = buttons.filter((_, i) => i !== index);
    setButtons(newButtons);
    onChange({ buttons: newButtons.length > 0 ? newButtons : undefined });
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
            {buttons.map((button, index) => (
              <div key={index} className="button-editor">
                <input
                  className="input"
                  type="text"
                  value={button.text}
                  onChange={(e) => handleButtonTextChange(index, e.target.value)}
                  placeholder="Текст кнопки"
                />
                <select
                  className="input"
                  value={button.nextState}
                  onChange={(e) => handleButtonNextStateChange(index, e.target.value)}
                >
                  {allStates.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
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
    </div>
  );
}

