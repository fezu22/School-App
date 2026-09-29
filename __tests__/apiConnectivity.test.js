jest.mock('react-native', () => ({
  NativeModules: {
    SourceCode: { scriptURL: 'http://192.168.1.26:8081/index.bundle' },
  },
}));

test('local API URL follows the Metro host for physical-device development', () => {
  const { API_URL } = require('../src/config');
  expect(API_URL).toBe('http://192.168.1.26:4000');
});

test('authenticated requests send the bearer token to the configured API URL', async () => {
  const { API_URL } = require('../src/config');
  const { api, setAccessToken } = require('../src/api/client');
  const originalFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    text: async () => JSON.stringify({ summary: {} }),
  });
  setAccessToken('principal-test-jwt');

  try {
    await api('/staff/dashboard');
    expect(global.fetch).toHaveBeenCalledWith(
      `${API_URL}/staff/dashboard`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer principal-test-jwt',
        }),
      }),
    );
  } finally {
    setAccessToken('');
    global.fetch = originalFetch;
  }
});