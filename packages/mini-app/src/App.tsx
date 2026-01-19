import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import BotList from './pages/BotList';
import BotEditor from './pages/BotEditor';
import Templates from './pages/Templates';
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
    // Инициализация Telegram WebApp SDK
    if (WebApp) {
      WebApp.ready();
      WebApp.expand();
      
      // Настройка темы
      if (WebApp.colorScheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
      }
    }
  }, []);

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

