module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: '@dialogue-constructor/shared',
            message: 'Use @dialogue-constructor/shared/browser in browser code.',
          },
          {
            name: '@dialogue-constructor/shared/server',
            message: 'Use @dialogue-constructor/shared/browser in browser code.',
          },
        ],
      },
    ],
  },
};
