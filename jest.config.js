process.env.NODE_ENV = 'test';
const reactNativePreset = require('@react-native/jest-preset');

module.exports = {
  ...reactNativePreset,
  transform: {
    ...reactNativePreset.transform,
    '^.+\\.(js|jsx|ts|tsx)$': 'babel-jest',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((@)?react-native|@react-native(-community)?|@react-navigation|@react-native-documents)/)',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/build/local-backups/', '/backend/'],
  testTimeout: 15000,
};
