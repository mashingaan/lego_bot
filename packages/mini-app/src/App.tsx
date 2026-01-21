import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import BotList from './pages/BotList';
import BotEditor from './pages/BotEditor';
import Templates from './pages/Templates';
import TelegramOnly from './components/TelegramOnly';
import { isTelegramWebApp } from './utils/api';
import './App.css';

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready(): void;
        expand(): void;
        close(): void;
        showAlert(message: string): void;
        showConfirm(message: string, callback?: (confirmed: boolean) => void): void;
        colorScheme: 'light' | 'dark';
        themeParams: {
          bg_color?: string;
          text_color?: string;
          hint_color?: string;
          link_color?: string;
          button_color?: string;
          button_text_color?: string;
          secondary_bg_color?: string;
        };
        initDataUnsafe: {
          user?: {
            id: number;
            first_name?: string;
            last_name?: string;
            username?: string;
            language_code?: string;
          };
        };
      };
    };
  }
}

const WebApp = window.Telegram?.WebApp;

function App() {
  useEffect(() => {
    try {
      console.log('🔧 App useEffect - initializing Telegram WebApp...');
      
      // Инициализация Telegram WebApp SDK
      if (WebApp) {
        console.log('✅ Telegram WebApp found');
        WebApp.ready();
        console.log('✅ WebApp.ready() called');
        
        WebApp.expand();
        console.log('✅ WebApp.expand() called');
        
        // Настройка темы
        if (WebApp.colorScheme === 'dark') {
          document.documentElement.setAttribute('data-theme', 'dark');
          console.log('✅ Dark theme applied');
        }
        
        console.log('📱 Telegram WebApp initialized:', {
          version: WebApp.version,
          platform: WebApp.platform,
          colorScheme: WebApp.colorScheme,
          user: WebApp.initDataUnsafe?.user,
        });
      } else {
        console.warn('⚠️ Telegram WebApp not found');
      }
    } catch (error) {
      console.error('❌ Error initializing Telegram WebApp:', error);
    }
  }, []);

  // Проверяем, что приложение запущено в Telegram
  const isInTelegram = isTelegramWebApp();
  console.log('🔍 Is in Telegram:', isInTelegram);
  
  if (!isInTelegram) {
    console.log('📱 Not in Telegram, showing TelegramOnly component');
    return <TelegramOnly />;
  }

  console.log('✅ Rendering main app');
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<BotList />} />
        <Route path="/bot/:id" element={<BotEditor />} />
        <Route path="/templates" element={<Templates />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export default App;

