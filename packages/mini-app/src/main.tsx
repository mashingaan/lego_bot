import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import App from './App';
import './index.css';

// Обработка ошибок на уровне приложения
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('❌ Mini App Error:', error);
    console.error('Error Info:', errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <h2>❌ Произошла ошибка</h2>
          <p>{this.state.error?.message || 'Неизвестная ошибка'}</p>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '16px',
              padding: '8px 16px',
              backgroundColor: '#0088cc',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Перезагрузить
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// Проверяем, что Telegram WebApp SDK загружен
function waitForTelegramSDK(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Telegram?.WebApp) {
      console.log('✅ Telegram WebApp SDK loaded');
      resolve();
      return;
    }

    // Ждем загрузки SDK (максимум 3 секунды)
    let attempts = 0;
    const maxAttempts = 30; // 30 попыток по 100мс = 3 секунды
    
    const checkInterval = setInterval(() => {
      attempts++;
      if (window.Telegram?.WebApp) {
        console.log('✅ Telegram WebApp SDK loaded (delayed)');
        clearInterval(checkInterval);
        resolve();
      } else if (attempts >= maxAttempts) {
        console.warn('⚠️ Telegram WebApp SDK not found, but continuing...');
        clearInterval(checkInterval);
        resolve(); // Разрешаем загрузку даже без SDK (для тестирования)
      }
    }, 100);
  });
}

// Инициализация приложения
async function initApp() {
  try {
    console.log('🚀 Initializing Mini App...');
    
    // Ждем загрузки Telegram SDK
    await waitForTelegramSDK();
    
    // Проверяем наличие root элемента
    const rootElement = document.getElementById('root');
    if (!rootElement) {
      throw new Error('Root element not found');
    }

    const manifestUrl = import.meta.env.VITE_TON_CONNECT_MANIFEST_URL;
    console.log('🔗 TON Connect Manifest URL:', manifestUrl || 'not set');

    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <ErrorBoundary>
          {manifestUrl ? (
            <TonConnectUIProvider manifestUrl={manifestUrl}>
              <BrowserRouter>
                <App />
              </BrowserRouter>
            </TonConnectUIProvider>
          ) : (
            <BrowserRouter>
              <App />
            </BrowserRouter>
          )}
        </ErrorBoundary>
      </React.StrictMode>,
    );

    console.log('✅ Mini App initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize Mini App:', error);
    const rootElement = document.getElementById('root');
    if (rootElement) {
      rootElement.innerHTML = `
        <div style="padding: 20px; text-align: center;">
          <h2>❌ Ошибка инициализации</h2>
          <p>${error instanceof Error ? error.message : 'Неизвестная ошибка'}</p>
          <button onclick="window.location.reload()" style="margin-top: 16px; padding: 8px 16px; background-color: #0088cc; color: white; border: none; border-radius: 4px; cursor: pointer;">
            Перезагрузить
          </button>
        </div>
      `;
    }
  }
}

// Запускаем инициализацию
initApp();


