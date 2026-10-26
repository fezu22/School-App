module.exports = {
  root: true,
  ignorePatterns: ['build/**', 'backend/dist/**'],
  extends: '@react-native',
  globals: {
    Buffer: 'readonly',
    globalThis: 'readonly',
  },
};
