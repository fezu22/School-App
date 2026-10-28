jest.mock('react-native', () => ({
  NativeModules: {},
  Platform: { OS: 'android' },
  TurboModuleRegistry: { get: jest.fn(() => null) },
}));

import { NativeModules, TurboModuleRegistry } from 'react-native';
import { API_ROOT, resolveApiRoot } from '../shared/services/apiConfig';

afterEach(() => {
  TurboModuleRegistry.get.mockReset().mockReturnValue(null);
  delete NativeModules.SourceCode;
  delete NativeModules.SchoolManagementConfig;
  delete globalThis.__SCHOOL_API_ROOT__;
  delete globalThis.__SCHOOL_API_PORT__;
});

test.each([
  ['localhost', 'http://localhost:5000/api'],
  ['192.168.1.23', 'http://192.168.1.23:5000/api'],
  ['10.0.2.2', 'http://10.0.2.2:5000/api'],
])('retains the iOS Metro host %s in bridgeless builds', (host, expected) => {
  TurboModuleRegistry.get.mockReturnValue({
    getConstants: () => ({
      scriptURL: `http://${host}:8081/index.bundle?platform=android`,
    }),
  });
  expect(resolveApiRoot({ development: true, platform: 'ios' })).toBe(expected);
  expect(TurboModuleRegistry.get).toHaveBeenCalledWith('SourceCode');
});

test('retains legacy SourceCode support for other platforms', () => {
  NativeModules.SourceCode = {
    scriptURL: 'http://192.168.1.50:8081/index.bundle',
  };
  expect(resolveApiRoot({ development: true, platform: 'ios' })).toBe(
    'http://192.168.1.50:5000/api',
  );
});

test.each([
  ['android', 'http://127.0.0.1:5000/api'],
  ['ios', 'http://127.0.0.1:5000/api'],
])('retains the %s fallback without a Metro URL', (platform, expected) => {
  expect(resolveApiRoot({ development: true, platform })).toBe(expected);
});

test('keeps the configured development API port', () => {
  globalThis.__SCHOOL_API_PORT__ = 5100;
  TurboModuleRegistry.get.mockReturnValue({
    getConstants: () => ({ scriptURL: 'http://localhost:8081/index.bundle' }),
  });
  expect(resolveApiRoot({ development: true })).toBe(
    'http://127.0.0.1:5100/api',
  );
});

test('explicit native configuration still takes precedence', () => {
  NativeModules.SchoolManagementConfig = { apiRoot: 'https://school.example/' };
  expect(resolveApiRoot({ development: false })).toBe(
    'https://school.example/api',
  );
  expect(TurboModuleRegistry.get).not.toHaveBeenCalled();
});

test('production still requires an explicit HTTPS API address', () => {
  expect(() => resolveApiRoot({ development: false })).toThrow(
    'not configured',
  );
  globalThis.__SCHOOL_API_ROOT__ = 'http://school.example';
  expect(() => resolveApiRoot({ development: false })).toThrow(
    'must use HTTPS',
  );
});

test('active Android development import resolves ADB loopback', () => {
  expect(API_ROOT).toBe('http://127.0.0.1:5000/api');
});

test.each(['192.168.1.23', 'localhost', '10.0.2.2'])(
  'Android ADB transport takes precedence over Metro host %s',
  host => {
    TurboModuleRegistry.get.mockReturnValue({
      getConstants: () => ({ scriptURL: `http://${host}:8081/index.bundle` }),
    });
    expect(resolveApiRoot({ development: true })).toBe(
      'http://127.0.0.1:5000/api',
    );
    expect(TurboModuleRegistry.get).not.toHaveBeenCalled();
  },
);

test.each(['global', 'native'])(
  'explicit %s development override wins over ADB',
  source => {
    if (source === 'global')
      globalThis.__SCHOOL_API_ROOT__ = ' http://dev.example:5100/ ';
    else
      NativeModules.SchoolManagementConfig = {
        apiRoot: 'http://dev.example:5100/',
      };
    expect(resolveApiRoot({ development: true })).toBe(
      'http://dev.example:5100/api',
    );
    expect(TurboModuleRegistry.get).not.toHaveBeenCalled();
  },
);

test('global configuration takes precedence over native configuration', () => {
  globalThis.__SCHOOL_API_ROOT__ = 'https://explicit.example';
  NativeModules.SchoolManagementConfig = { apiRoot: 'https://native.example' };
  expect(resolveApiRoot({ development: true })).toBe(
    'https://explicit.example/api',
  );
});

test.each(['global', 'native'])(
  'production rejects HTTP from %s configuration',
  source => {
    if (source === 'global')
      globalThis.__SCHOOL_API_ROOT__ = 'http://127.0.0.1:5000';
    else
      NativeModules.SchoolManagementConfig = {
        apiRoot: 'http://127.0.0.1:5000',
      };
    expect(() => resolveApiRoot({ development: false })).toThrow(
      'must use HTTPS',
    );
  },
);

test('production never uses development port or Metro fallbacks', () => {
  globalThis.__SCHOOL_API_PORT__ = 5100;
  NativeModules.SourceCode = {
    scriptURL: 'http://192.168.1.23:8081/index.bundle',
  };
  expect(() => resolveApiRoot({ development: false })).toThrow(
    'not configured',
  );
  expect(TurboModuleRegistry.get).not.toHaveBeenCalled();
});
