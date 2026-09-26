import {
  api,
  onUnauthorized,
  setAccessToken,
  setChildSelectionRequired,
  setSelectedChildId,
} from '../src/api/client';

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
});

describe('authenticated API client', () => {
  let originalFetch;
  beforeEach(() => {
    originalFetch = global.fetch;
    setAccessToken('test-token');
    setChildSelectionRequired(false);
    setSelectedChildId('');
  });
  afterEach(() => {
    global.fetch = originalFetch;
    setAccessToken('');
    setSelectedChildId('');
    setChildSelectionRequired(false);
  });

  test('clears session through the centralized handler on authenticated 401', async () => {
    const expired = jest.fn();
    const unsubscribe = onUnauthorized(expired);
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse(401, { error: 'Please sign in again' }));
    await expect(api('/dashboard')).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  test('requires a selected child and sends only that child in the API scope header', async () => {
    setChildSelectionRequired(true);
    await expect(api('/invoices')).rejects.toMatchObject({
      code: 'NO_CHILD_SELECTED',
    });
    setSelectedChildId('child-ava');
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { items: [] }));
    await api('/invoices');
    expect(global.fetch.mock.calls[0][1].headers['X-School-Child-ID']).toBe(
      'child-ava',
    );
  });

  test('discards a response started for the previous selected child', async () => {
    setChildSelectionRequired(true);
    setSelectedChildId('child-ava');
    let finish;
    global.fetch = jest.fn(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
    const pending = api('/attendance');
    setSelectedChildId('child-leo');
    finish(jsonResponse(200, { items: [{ student: 'Ava' }] }));
    await expect(pending).rejects.toMatchObject({
      code: 'STALE_CHILD_SELECTION',
    });
  });
});
