// Конфигурация API
// Для локальной разработки используйте: http://localhost:3000
// Для продакшена укажите URL вашего API сервера
const API_BASE_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:3000' 
  : 'https://lego-bot-core.vercel.app'; // ← API URL для продакшена

// Глобальные переменные
let currentUser = null;
let currentBotId = null;
let bots = [];

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    checkTelegramWidget();
});

// Проверка инициализации Telegram Widget
function checkTelegramWidget() {
    setTimeout(() => {
        const widget = document.getElementById('telegram-login');
        if (widget) {
            console.log('Telegram login widget element found:', widget);
            console.log('Widget innerHTML:', widget.innerHTML);
            console.log('Widget children:', widget.children);
            
            // Проверяем, создал ли виджет iframe
            const iframe = widget.querySelector('iframe');
            if (iframe) {
                console.log('Telegram Widget iframe found:', iframe);
                console.log('Iframe src:', iframe.src);
            } else {
                console.warn('Telegram Widget iframe not found. Widget may not be initialized.');
                console.warn('Possible reasons:');
                console.warn('1. Domain not set in @BotFather');
                console.warn('2. Script not loaded (check Network tab)');
                console.warn('3. Domain mismatch (current domain:', window.location.hostname, ')');
            }
        } else {
            console.error('Telegram login widget element not found!');
        }
    }, 3000); // Ждем 3 секунды для загрузки виджета
}

function initializeApp() {
    // Проверяем сохраненные данные пользователя
    const savedUser = localStorage.getItem('telegram_user');
    if (savedUser) {
        try {
            currentUser = JSON.parse(savedUser);
            showEditor();
            loadBots();
        } catch (e) {
            console.error('Error parsing saved user:', e);
            localStorage.removeItem('telegram_user');
        }
    }

    // Обработчики событий
    document.getElementById('logout-btn')?.addEventListener('click', handleLogout);
    document.getElementById('bot-select')?.addEventListener('change', handleBotSelect);
    document.getElementById('load-schema-btn')?.addEventListener('click', handleLoadSchema);
    document.getElementById('validate-btn')?.addEventListener('click', handleValidate);
    document.getElementById('format-btn')?.addEventListener('click', handleFormat);
    document.getElementById('save-btn')?.addEventListener('click', handleSave);
    document.getElementById('schema-editor')?.addEventListener('input', handleEditorInput);
}

// Обработка авторизации через Telegram
// Функция должна быть глобальной для работы Telegram Widget
window.onTelegramAuth = function(user) {
    console.log('🎉 ===== TELEGRAM AUTH CALLBACK CALLED =====');
    console.log('✅ Telegram auth received:', user);
    console.log('✅ User data:', JSON.stringify(user, null, 2));
    
    if (!user) {
        console.error('❌ User data is empty!');
        alert('Ошибка: данные пользователя не получены');
        return;
    }
    
    currentUser = user;
    localStorage.setItem('telegram_user', JSON.stringify(user));
    
    // Показываем сообщение об успешной авторизации
    console.log('✅ User authenticated:', user.first_name, user.last_name);
    console.log('✅ User ID:', user.id);
    console.log('✅ User hash:', user.hash);
    
    showEditor();
    
    // Загружаем ботов
    loadBots().catch(error => {
        console.error('❌ Error loading bots:', error);
        alert('Ошибка при загрузке ботов: ' + error.message);
    });
    
    console.log('✅ ===== AUTHENTICATION COMPLETE =====');
};

// Проверяем, что функция доступна глобально
console.log('✅ onTelegramAuth function defined:', typeof window.onTelegramAuth);

function handleLogout() {
    currentUser = null;
    localStorage.removeItem('telegram_user');
    location.reload();
}

function showEditor() {
    document.getElementById('login-prompt').style.display = 'none';
    document.getElementById('editor-section').style.display = 'block';
    if (currentUser) {
        document.getElementById('user-name').textContent = `${currentUser.first_name} ${currentUser.last_name || ''}`.trim();
        document.getElementById('user-info').style.display = 'flex';
        document.getElementById('telegram-login').style.display = 'none';
    }
}

// Загрузка списка ботов
async function loadBots() {
    if (!currentUser) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/bots?user_id=${currentUser.id}`, {
            headers: {
                'Authorization': `Bearer ${currentUser.hash}`,
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ API Error:', response.status, errorText);
            throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
        }

        const data = await response.json();
        console.log('✅ Bots loaded:', data);
        bots = data;
        populateBotSelect();
    } catch (error) {
        console.error('Error loading bots:', error);
        showError('Не удалось загрузить список ботов. Проверьте подключение к API.');
    }
}

function populateBotSelect() {
    const select = document.getElementById('bot-select');
    select.innerHTML = '<option value="">-- Выберите бота --</option>';
    
    bots.forEach(bot => {
        const option = document.createElement('option');
        option.value = bot.id;
        option.textContent = `${bot.name} (${bot.id.substring(0, 8)}...)`;
        select.appendChild(option);
    });
}

function handleBotSelect(e) {
    currentBotId = e.target.value;
    document.getElementById('load-schema-btn').disabled = !currentBotId;
    document.getElementById('save-btn').disabled = true;
    
    if (!currentBotId) {
        clearEditor();
    }
}

// Загрузка схемы бота
async function handleLoadSchema() {
    if (!currentBotId) return;

    try {
        showLoading('Загрузка схемы...');
        
        const response = await fetch(`${API_BASE_URL}/api/bot/${currentBotId}/schema`, {
            headers: {
                'Authorization': `Bearer ${currentUser.hash}`,
            },
        });

        if (!response.ok) {
            if (response.status === 404) {
                // Схема не найдена, показываем пустую
                setEditorContent('{\n  "version": 1,\n  "states": {},\n  "initialState": "start"\n}');
                updatePreview({ version: 1, states: {}, initialState: 'start' });
                return;
            }
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const schema = await response.json();
        setEditorContent(JSON.stringify(schema, null, 2));
        updatePreview(schema);
        clearError();
    } catch (error) {
        console.error('Error loading schema:', error);
        showError('Не удалось загрузить схему бота.');
    }
}

// Сохранение схемы
async function handleSave() {
    if (!currentBotId) return;

    const schemaText = document.getElementById('schema-editor').value.trim();
    
    // Валидация перед сохранением
    if (!validateJSON(schemaText)) {
        showError('Исправьте ошибки в JSON перед сохранением.');
        return;
    }

    try {
        showLoading('Сохранение схемы...');
        
        const schema = JSON.parse(schemaText);
        
        // Валидация структуры схемы
        if (!validateSchemaStructure(schema)) {
            showError('Схема не соответствует требуемой структуре. Проверьте наличие version, states и initialState.');
            return;
        }

        const response = await fetch(`${API_BASE_URL}/api/bot/${currentBotId}/schema`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentUser.hash}`,
            },
            body: JSON.stringify(schema),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        showSuccess('Схема успешно сохранена!');
        updatePreview(schema);
        
        // Обновляем версию в предпросмотре
        setTimeout(() => {
            document.querySelector('.success-message')?.remove();
        }, 3000);
    } catch (error) {
        console.error('Error saving schema:', error);
        showError(`Ошибка при сохранении: ${error.message}`);
    }
}

// Валидация JSON
function handleValidate() {
    const schemaText = document.getElementById('schema-editor').value.trim();
    validateJSON(schemaText);
}

function validateJSON(text) {
    const editor = document.getElementById('schema-editor');
    const errorDiv = document.getElementById('error-message');
    
    if (!text.trim()) {
        editor.classList.remove('error', 'valid');
        errorDiv.style.display = 'none';
        return false;
    }

    try {
        const parsed = JSON.parse(text);
        editor.classList.remove('error');
        editor.classList.add('valid');
        errorDiv.style.display = 'none';
        
        // Дополнительная валидация структуры
        if (!validateSchemaStructure(parsed)) {
            editor.classList.remove('valid');
            editor.classList.add('error');
            showError('Схема не соответствует требуемой структуре. Проверьте наличие version, states и initialState.');
            return false;
        }
        
        return true;
    } catch (error) {
        editor.classList.remove('valid');
        editor.classList.add('error');
        showError(`Ошибка JSON: ${error.message}`);
        return false;
    }
}

function validateSchemaStructure(schema) {
    if (!schema || typeof schema !== 'object') return false;
    if (schema.version !== 1) return false;
    if (!schema.states || typeof schema.states !== 'object') return false;
    if (!schema.initialState || typeof schema.initialState !== 'string') return false;
    if (!schema.states[schema.initialState]) return false;
    
    // Проверяем состояния
    for (const [stateKey, state] of Object.entries(schema.states)) {
        if (typeof state !== 'object' || !state) return false;
        if (!state.message || typeof state.message !== 'string') return false;
        
        if (state.buttons) {
            if (!Array.isArray(state.buttons)) return false;
            for (const button of state.buttons) {
                if (!button.text || !button.nextState) return false;
                if (!schema.states[button.nextState]) return false;
            }
        }
    }
    
    return true;
}

// Форматирование JSON
function handleFormat() {
    const editor = document.getElementById('schema-editor');
    const text = editor.value.trim();
    
    if (!text) return;
    
    try {
        const parsed = JSON.parse(text);
        const formatted = JSON.stringify(parsed, null, 2);
        editor.value = formatted;
        validateJSON(formatted);
    } catch (error) {
        showError(`Ошибка форматирования: ${error.message}`);
    }
}

// Обработка изменений в редакторе
function handleEditorInput() {
    const text = document.getElementById('schema-editor').value.trim();
    document.getElementById('save-btn').disabled = !text || !currentBotId;
    
    // Автоматическая валидация при вводе (с задержкой)
    clearTimeout(window.validateTimeout);
    window.validateTimeout = setTimeout(() => {
        if (text) {
            validateJSON(text);
        }
    }, 500);
}

// Обновление предпросмотра
function updatePreview(schema) {
    const preview = document.getElementById('schema-preview');
    
    if (!schema || !schema.states || Object.keys(schema.states).length === 0) {
        preview.innerHTML = '<p class="placeholder">Схема пуста. Добавьте состояния для предпросмотра.</p>';
        return;
    }
    
    let html = `<div class="preview-header">
        <strong>Версия:</strong> ${schema.version}<br>
        <strong>Начальное состояние:</strong> <code>${schema.initialState}</code><br>
        <strong>Всего состояний:</strong> ${Object.keys(schema.states).length}
    </div><br>`;
    
    for (const [stateName, state] of Object.entries(schema.states)) {
        html += `<div class="state-item">
            <div class="state-name">${stateName === schema.initialState ? '⭐ ' : ''}${stateName}</div>
            <div class="state-message">${escapeHtml(state.message)}</div>`;
        
        if (state.buttons && state.buttons.length > 0) {
            html += '<div class="buttons-list">';
            state.buttons.forEach(button => {
                html += `<span class="button-item" data-next-state="${button.nextState}">${escapeHtml(button.text)}</span>`;
            });
            html += '</div>';
        }
        
        html += '</div>';
    }
    
    preview.innerHTML = html;
}

// Вспомогательные функции
function setEditorContent(content) {
    document.getElementById('schema-editor').value = content;
    document.getElementById('save-btn').disabled = false;
}

function clearEditor() {
    document.getElementById('schema-editor').value = '';
    document.getElementById('schema-preview').innerHTML = '<p class="placeholder">Выберите бота и загрузите схему для предпросмотра</p>';
    clearError();
}

function showError(message) {
    const errorDiv = document.getElementById('error-message');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    errorDiv.classList.add('show');
}

function showSuccess(message) {
    const errorDiv = document.getElementById('error-message');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    errorDiv.className = 'success-message show';
    setTimeout(() => {
        errorDiv.style.display = 'none';
        errorDiv.className = 'error-message';
    }, 3000);
}

function clearError() {
    const errorDiv = document.getElementById('error-message');
    errorDiv.style.display = 'none';
    errorDiv.classList.remove('show');
    document.getElementById('schema-editor').classList.remove('error', 'valid');
}

function showLoading(message) {
    const preview = document.getElementById('schema-preview');
    preview.innerHTML = `<div class="loading">${message}</div>`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

