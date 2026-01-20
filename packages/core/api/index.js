"use strict";
// Vercel Serverless Function
// Экспортируем Express app для работы в Vercel
// Импортируем из скомпилированного dist
// @ts-ignore - dist файлы могут не иметь типов
const app = require('../dist/index').default || require('../dist/index');
// Vercel ожидает экспорт handler функции
module.exports = app;
//# sourceMappingURL=index.js.map