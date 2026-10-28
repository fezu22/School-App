jest.mock('../shared/services/apiConfig', () => ({
  API_ROOT: 'http://127.0.0.1:5000/api',
}));
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
  setGenericPassword: jest.fn(async () => true),
  resetGenericPassword: jest.fn(async () => true),
}));

import { authRequest } from '../shared/services/authRequest';
import { login } from '../shared/services/authService';
import {
  clearAccessToken,
  getAuthHeaders,
} from '../shared/services/authSession';

const originalFetch = global.fetch;
const reply = (status, payload) => ({
  ok: status < 400,
  status,
  json: async () => payload,
});
beforeEach(() => {
  global.fetch = jest.fn();
  clearAccessToken();
});
afterEach(() => {
  jest.useRealTimers();
  global.fetch = originalFetch;
  clearAccessToken();
});

test('transport failure has a connection-specific error', async () => {
  fetch.mockRejectedValue(new TypeError('Network request failed'));
  await expect(authRequest('/auth/login', {}, false)).rejects.toThrow(
    'Could not reach the school API',
  );
});

test('the bounded 15-second abort is reported as a timeout', async () => {
  jest.useFakeTimers();
  fetch.mockImplementation(
    (url, { signal }) =>
      new Promise((resolve, reject) => {
        signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      }),
  );
  const pending = authRequest('/auth/login', {}, false);
  await Promise.all([
    expect(pending).rejects.toThrow('The school API timed out'),
    jest.advanceTimersByTimeAsync(15000),
  ]);
  expect(jest.getTimerCount()).toBe(0);
});

test.each([401, 403, 500])(
  'HTTP %s server errors retain their server message',
  async status => {
    fetch.mockResolvedValue(
      reply(status, { success: false, error: `Server rejection ${status}` }),
    );
    await expect(authRequest('/auth/login', {}, false)).rejects.toThrow(
      `Server rejection ${status}`,
    );
  },
);

test('non-JSON HTTP failure retains HTTP status rather than becoming a network error', async () => {
  fetch.mockResolvedValue({
    ok: false,
    status: 502,
    json: async () => {
      throw new SyntaxError('not JSON');
    },
  });
  await expect(authRequest('/auth/login', {}, false)).rejects.toThrow(
    'School API request failed (502)',
  );
});

test('invalid successful session is a session error, not a connectivity error', async () => {
  fetch.mockResolvedValue(
    reply(200, { success: true, data: { user: { id: 'fixture' } } }),
  );
  await expect(
    login('admin@fixture.invalid', 'fixture-only-password'),
  ).rejects.toThrow('invalid session');
  expect(getAuthHeaders()).toEqual({});
});
