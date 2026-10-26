jest.mock('../shared/services/apiConfig', () => ({ API_ROOT: 'http://school.test/api' }));
let mockCredentials = null;
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
  setGenericPassword: jest.fn(async (username, password) => {
    mockCredentials = { username, password };
    return true;
  }),
  getGenericPassword: jest.fn(async () => mockCredentials || false),
  resetGenericPassword: jest.fn(async () => {
    mockCredentials = null;
    return true;
  }),
}));
import { login, logout, restoreSession, validateSession } from '../shared/services/authService';
import { studentApi } from '../roles/student/studentService';
import { parentApi } from '../roles/parent/parentService';
import { financeApi } from '../roles/finance/financeService';
import { clearAccessToken, setAccessToken, getAuthHeaders, subscribeSessionExpiry, checkSessionExpiry } from '../shared/services/authSession';

const reply = (status, data) => ({ ok: status < 400, status, json: async () => data });
const futureExpiry = () => new Date(Date.now() + 60000).toISOString();
beforeEach(() => { clearAccessToken(); mockCredentials = null; global.fetch = jest.fn(); });
afterEach(() => { clearAccessToken(); jest.restoreAllMocks(); });

test('login sends credentials without a stale bearer and verifies the linked profile', async () => {
  setAccessToken('old');
  fetch.mockResolvedValueOnce(reply(200, { success: true, data: { token: 'new', expiresAt: futureExpiry(), user: { id: 'account', role: 'student' } } }))
    .mockResolvedValueOnce(reply(200, { success: true, data: { id: '002' } }));
  await expect(login(' student@school.test ', 'test-only')).resolves.toEqual({ id: 'account', role: 'student' });
  expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  expect(JSON.parse(fetch.mock.calls[0][1].body).email).toBe('student@school.test');
  expect(fetch.mock.calls[1][0]).toBe('http://school.test/api/students/me');
  expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer new');
});

test('missing linked profile rejects login and revokes the issued session', async () => {
  fetch.mockResolvedValueOnce(reply(200, { success: true, data: { token: 'new', expiresAt: futureExpiry(), user: { id: 'account', role: 'student' } } }))
    .mockResolvedValueOnce(reply(403, { success: false, error: 'No student record is linked to this user.' }))
    .mockResolvedValueOnce(reply(200, { success: true }));
  await expect(login('student@school.test', 'test-only')).rejects.toThrow('No student record');
  expect(fetch.mock.calls[2][1].headers.Authorization).toBe('Bearer new');
  expect(getAuthHeaders()).toEqual({});
});

test('student 401 clears the bearer and notifies the workspace', async () => {
  setAccessToken('expired');
  const listener = jest.fn(); const unsubscribe = subscribeSessionExpiry(listener);
  fetch.mockResolvedValue(reply(401, { success: false, error: 'Session is invalid or expired.' }));
  await expect(studentApi.getProfile()).rejects.toThrow('expired');
  expect(listener).toHaveBeenCalledTimes(1);
  expect(getAuthHeaders()).toEqual({}); unsubscribe();
});

test('403 does not expire a valid session', async () => {
  setAccessToken('valid');
  fetch.mockResolvedValue(reply(403, { success: false, error: 'Forbidden' }));
  await expect(studentApi.getProfile()).rejects.toThrow('Forbidden');
  expect(getAuthHeaders().Authorization).toBe('Bearer valid');
});

test.each([
  ['Parent', () => parentApi.getChildren()],
  ['Finance', () => financeApi.searchStudents('student')],
  ['Finance notifications', () => financeApi.getNotifications()],
])('%s 401 immediately expires the shared session', async (_role, request) => {
  setAccessToken('expired');
  const listener = jest.fn(); const unsubscribe = subscribeSessionExpiry(listener);
  fetch.mockResolvedValue(reply(401, { success: false, error: 'Session is invalid or expired.' }));
  await expect(request()).rejects.toThrow('expired');
  expect(listener).toHaveBeenCalledTimes(1);
  expect(getAuthHeaders()).toEqual({});
  unsubscribe();
});

test('delayed old-session 401 does not clear a newer login', async () => {
  setAccessToken('old'); let resolve;
  fetch.mockImplementation(() => new Promise(done => { resolve = done; }));
  const pending = validateSession(); setAccessToken('new');
  resolve(reply(401, { success: false, error: 'Expired' }));
  await expect(pending).rejects.toThrow('Expired');
  expect(getAuthHeaders().Authorization).toBe('Bearer new');
});

test('server-provided deadline expires the local session', () => {
  const listener = jest.fn(); const unsubscribe = subscribeSessionExpiry(listener);
  setAccessToken('expired', new Date(Date.now() - 1000).toISOString());
  checkSessionExpiry(); expect(listener).toHaveBeenCalledTimes(1);
  expect(getAuthHeaders()).toEqual({}); unsubscribe();
});

test('offline logout clears immediately and resolves so the navigator exits', async () => {
  setAccessToken('valid'); fetch.mockRejectedValue(new TypeError('Network request failed'));
  const pending = logout(); expect(getAuthHeaders()).toEqual({});
  await expect(pending).resolves.toEqual({ revoked: false });
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer valid');
});

test('successful logout sends the bearer for server revocation', async () => {
  setAccessToken('valid'); fetch.mockResolvedValue(reply(200, { success: true }));
  await expect(logout()).resolves.toEqual({ revoked: true });
  expect(getAuthHeaders()).toEqual({});
});

test('restores an unexpired keychain session only after server validation', async () => {
  const expiresAt = futureExpiry();
  mockCredentials = {
    username: 'school-session',
    password: JSON.stringify({
      token: 'stored-token',
      expiresAt,
      user: { id: 'account', role: 'student' },
    }),
  };
  fetch.mockResolvedValue(
    reply(200, {
      success: true,
      data: { id: 'account', role: 'student', fullName: 'Existing Student' },
    }),
  );
  await expect(restoreSession()).resolves.toMatchObject({
    id: 'account',
    role: 'student',
  });
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe(
    'Bearer stored-token',
  );
});

test('does not call the API for an expired stored session', async () => {
  mockCredentials = {
    username: 'school-session',
    password: JSON.stringify({
      token: 'expired-token',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      user: { id: 'account', role: 'student' },
    }),
  };
  await expect(restoreSession()).resolves.toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  expect(mockCredentials).toBeNull();
});

test('invalid restored bearer clears the keychain session', async () => {
  mockCredentials = {
    username: 'school-session',
    password: JSON.stringify({
      token: 'revoked-token',
      expiresAt: futureExpiry(),
      user: { id: 'account', role: 'student' },
    }),
  };
  fetch.mockResolvedValue(
    reply(401, { success: false, error: 'Session is invalid or expired.' }),
  );
  await expect(restoreSession()).rejects.toThrow('expired');
  expect(getAuthHeaders()).toEqual({});
  expect(mockCredentials).toBeNull();
});

test('connectivity errors retain the session and explain the failure', async () => {
  setAccessToken('valid'); fetch.mockRejectedValue(new TypeError('Network request failed'));
  await expect(validateSession()).rejects.toThrow('Could not reach the school API');
  expect(getAuthHeaders().Authorization).toBe('Bearer valid');
});

test('homework details use the authenticated ownership-scoped endpoint', async () => {
  setAccessToken('valid');
  fetch.mockResolvedValue(
    reply(200, { success: true, data: { id: 'HW-1', title: 'Essay' } }),
  );
  await expect(studentApi.getHomeworkDetails('HW-1')).resolves.toMatchObject({
    id: 'HW-1',
  });
  expect(fetch.mock.calls[0][0]).toBe(
    'http://school.test/api/students/me/homework/HW-1',
  );
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer valid');
});

test('homework submission sends authenticated multipart text and attachment', async () => {
  setAccessToken('valid');
  const append = jest.spyOn(FormData.prototype, 'append');
  fetch.mockResolvedValue(
    reply(201, { success: true, data: { id: 'SUB-1', status: 'submitted' } }),
  );
  await expect(
    studentApi.submitHomework('HW-1', {
      text: 'My completed answer',
      uri: 'content://picker/answer.pdf',
      name: 'answer.pdf',
      type: 'application/pdf',
    }),
  ).resolves.toMatchObject({ status: 'submitted' });
  const options = fetch.mock.calls[0][1];
  expect(options.method).toBe('POST');
  expect(options.headers.Authorization).toBe('Bearer valid');
  expect(options.headers['Content-Type']).toBeUndefined();
  expect(options.body).toBeInstanceOf(FormData);
  expect(append).toHaveBeenCalledWith('text', 'My completed answer');
  expect(append).toHaveBeenCalledWith(
    'file',
    {
      uri: 'content://picker/answer.pdf',
      name: 'answer.pdf',
      type: 'application/pdf',
    },
  );
});

test('parent progress is requested for only the selected child', async () => {
  setAccessToken('valid');
  fetch.mockResolvedValue(
    reply(200, { success: true, data: [{ id: 'PROGRESS-1' }] }),
  );
  await expect(parentApi.getProgress('child/002')).resolves.toHaveLength(1);
  expect(fetch.mock.calls[0][0]).toBe(
    'http://school.test/api/parents/me/children/child%2F002/progress',
  );
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer valid');
});

test('parent checkout and payment status stay on authenticated Parent routes', async () => {
  setAccessToken('valid');
  fetch
    .mockResolvedValueOnce(
      reply(201, {
        success: true,
        data: {
          paymentId: 'PAY-1',
          checkoutUrl: 'https://merchant.example/checkout/PAY-1',
          status: 'pending',
        },
      }),
    )
    .mockResolvedValueOnce(
      reply(200, {
        success: true,
        data: { paymentId: 'PAY-1', status: 'pending', receipt: null },
      }),
    );
  await parentApi.createFeeCheckout('002', 'INV-1', 'easypaisa');
  await expect(parentApi.getFeePaymentStatus('PAY-1')).resolves.toMatchObject({
    status: 'pending',
    receipt: null,
  });
  expect(fetch.mock.calls[0][0]).toBe(
    'http://school.test/api/parents/me/payments/children/002/invoices/INV-1/checkout',
  );
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
    method: 'easypaisa',
  });
  expect(fetch.mock.calls[1][0]).toBe(
    'http://school.test/api/parents/me/payments/transactions/PAY-1/status',
  );
  expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer valid');
});

test('Student and Parent applications use authenticated ownership-scoped routes', async () => {
  setAccessToken('application-token');
  fetch
    .mockResolvedValueOnce(reply(201, { success: true, data: { id: 'student-app', status: 'submitted' } }))
    .mockResolvedValueOnce(reply(200, { success: true, data: [{ id: 'student-app', status: 'approved' }] }))
    .mockResolvedValueOnce(reply(201, { success: true, data: { id: 'parent-app', status: 'submitted' } }))
    .mockResolvedValueOnce(reply(200, { success: true, data: [{ id: 'parent-app', status: 'needs_information' }] }));

  await studentApi.submitApplication({ title: 'Leave', message: 'Medical' });
  await studentApi.getApplications();
  await parentApi.submitApplication('002', { title: 'Leave', message: 'Medical' });
  await parentApi.getApplications('002');

  expect(fetch.mock.calls.map(call => call[0])).toEqual([
    expect.stringMatching(/\/students\/me\/applications$/),
    expect.stringMatching(/\/students\/me\/applications$/),
    expect.stringMatching(/\/parents\/me\/children\/002\/applications$/),
    expect.stringMatching(/\/parents\/me\/children\/002\/applications$/),
  ]);
  fetch.mock.calls.forEach(([, options]) =>
    expect(options.headers.Authorization).toBe('Bearer application-token'),
  );
});

test('Parent opens an explicitly shared DLP only through its notification route', async () => {
  setAccessToken('parent-notification-token');
  fetch
    .mockResolvedValueOnce(reply(200, {
      success: true,
      data: {
        notifications: [{ id: 'notice-1', type: 'parent_dlp_shared' }],
        unreadCount: 1,
      },
    }))
    .mockResolvedValueOnce(reply(200, { success: true, data: { read: true } }))
    .mockResolvedValueOnce(reply(200, {
      success: true,
      data: {
        notification: { id: 'notice-1', type: 'parent_dlp_shared' },
        dlpVersion: { id: 'dlp-version-7', status: 'published' },
      },
    }));

  await parentApi.getNotifications();
  await parentApi.markNotificationRead('notice-1');
  await expect(parentApi.openNotification('notice-1')).resolves.toMatchObject({
    notification: { id: 'notice-1', type: 'parent_dlp_shared' },
    dlpVersion: { id: 'dlp-version-7', status: 'published' },
  });
  expect(fetch.mock.calls.map(call => call[0])).toEqual([
    'http://school.test/api/parents/me/notifications',
    'http://school.test/api/parents/me/notifications/notice-1/read',
    'http://school.test/api/parents/me/notifications/notice-1',
  ]);
  fetch.mock.calls.forEach(([, options]) =>
    expect(options.headers.Authorization).toBe('Bearer parent-notification-token'),
  );
});

test('Finance verification, rejection, and receipt detail remain authenticated', async () => {
  setAccessToken('finance-token');
  fetch
    .mockResolvedValueOnce(reply(200, { success: true, data: { status: 'confirmed' } }))
    .mockResolvedValueOnce(reply(200, { success: true, data: { status: 'rejected' } }))
    .mockResolvedValueOnce(reply(200, { success: true, data: { receiptNumber: 'RCT-1' } }));

  await financeApi.verifyPayment('507f1f77bcf86cd799439011');
  await financeApi.rejectPayment('507f1f77bcf86cd799439012', 'Duplicate bank reference');
  await financeApi.getReceipt('507f1f77bcf86cd799439011');

  expect(fetch.mock.calls.map(call => call[0])).toEqual([
    'http://school.test/api/finance/payments/507f1f77bcf86cd799439011/verify',
    'http://school.test/api/finance/payments/507f1f77bcf86cd799439012/reject',
    'http://school.test/api/finance/receipts/507f1f77bcf86cd799439011',
  ]);
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
    reason: 'Duplicate bank reference',
  });
  fetch.mock.calls.forEach(([, options]) =>
    expect(options.headers.Authorization).toBe('Bearer finance-token'),
  );
});
