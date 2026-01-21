import './TelegramOnly.css';

export default function TelegramOnly() {
  return (
    <div className="telegram-only">
      <div className="telegram-only-content">
        <div className="telegram-only-icon">📱</div>
        <h2>Это Telegram Mini App</h2>
        <p>
          Это приложение работает только внутри Telegram.
        </p>
        <p>
          Чтобы использовать приложение:
        </p>
        <ol>
          <li>Откройте вашего бота в Telegram</li>
          <li>Нажмите на кнопку меню или используйте команду</li>
          <li>Приложение откроется внутри Telegram</li>
        </ol>
        <p className="telegram-only-hint">
          💡 Если у вас уже есть бот, настройте кнопку меню через @BotFather
        </p>
        <div className="telegram-only-footer">
          <a 
            href="https://t.me/BotFather" 
            target="_blank" 
            rel="noopener noreferrer"
            className="btn btn-primary"
          >
            Открыть @BotFather
          </a>
        </div>
      </div>
    </div>
  );
}


