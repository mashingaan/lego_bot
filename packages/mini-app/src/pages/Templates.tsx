import { useNavigate } from 'react-router-dom';
import { BotSchema } from '@dialogue-constructor/shared';

const TEMPLATES: Array<{ name: string; description: string; schema: BotSchema }> = [
  {
    name: 'Простой привет',
    description: 'Базовый шаблон с приветствием',
    schema: {
      version: 1,
      initialState: 'start',
      states: {
        start: {
          message: 'Привет! 👋\n\nЧем могу помочь?',
          buttons: [
            { text: 'Информация', nextState: 'info' },
            { text: 'Контакты', nextState: 'contacts' },
          ],
        },
        info: {
          message: 'Это информационный бот.\n\nВыберите опцию:',
          buttons: [
            { text: 'О нас', nextState: 'about' },
            { text: 'Услуги', nextState: 'services' },
            { text: '← Назад', nextState: 'start' },
          ],
        },
        contacts: {
          message: '📞 Контакты:\n\nТелефон: +7 (XXX) XXX-XX-XX\nEmail: info@example.com',
          buttons: [{ text: '← Назад', nextState: 'start' }],
        },
        about: {
          message: 'О нас:\n\nМы занимаемся...',
          buttons: [{ text: '← Назад', nextState: 'info' }],
        },
        services: {
          message: 'Наши услуги:\n\n1. Услуга 1\n2. Услуга 2',
          buttons: [{ text: '← Назад', nextState: 'info' }],
        },
      },
    },
  },
  {
    name: 'Опрос',
    description: 'Бот для проведения опросов',
    schema: {
      version: 1,
      initialState: 'welcome',
      states: {
        welcome: {
          message: 'Добро пожаловать в опрос!',
          buttons: [{ text: 'Начать опрос', nextState: 'question1' }],
        },
        question1: {
          message: 'Вопрос 1: Как вам наш сервис?',
          buttons: [
            { text: 'Отлично', nextState: 'question2' },
            { text: 'Хорошо', nextState: 'question2' },
            { text: 'Плохо', nextState: 'question2' },
          ],
        },
        question2: {
          message: 'Вопрос 2: Рекомендуете ли вы нас?',
          buttons: [
            { text: 'Да', nextState: 'thanks' },
            { text: 'Нет', nextState: 'thanks' },
          ],
        },
        thanks: {
          message: 'Спасибо за участие в опросе! 🙏',
        },
      },
    },
  },
  {
    name: 'Пустой шаблон',
    description: 'Начните с нуля',
    schema: {
      version: 1,
      initialState: 'start',
      states: {
        start: {
          message: 'Привет!',
        },
      },
    },
  },
];

export default function Templates() {
  const navigate = useNavigate();

  // В реальном приложении здесь будет функция для применения шаблона к боту
  const handleTemplateSelect = (_template: BotSchema) => {
    // Показываем предпросмотр или применяем к текущему боту
    alert('Выберите бота для применения шаблона в редакторе');
    navigate('/');
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Шаблоны</h1>
        <p className="page-subtitle">Выберите готовый шаблон</p>
      </div>

      {TEMPLATES.map((template, index) => (
        <div key={index} className="card">
          <div style={{ marginBottom: '8px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '4px' }}>
              {template.name}
            </h3>
            <p style={{ fontSize: '14px', color: 'var(--tg-theme-hint-color)' }}>
              {template.description}
            </p>
            <p style={{ fontSize: '12px', color: 'var(--tg-theme-hint-color)', marginTop: '8px' }}>
              Состояний: {Object.keys(template.schema.states).length}
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => handleTemplateSelect(template.schema)}
            style={{ width: '100%', marginTop: '8px' }}
          >
            Использовать шаблон
          </button>
        </div>
      ))}
    </div>
  );
}

