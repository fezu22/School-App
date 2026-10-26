import {
  setAccessToken,
  clearAccessToken,
  getAuthHeaders,
  subscribeSessionExpiry,
} from './authSession';
import { authRequest } from './authRequest';
import {
  clearStoredSession,
  loadSession,
  saveSession,
} from './sessionStorage';

subscribeSessionExpiry(() => {
  clearStoredSession().catch(() => {});
});

export async function login(email, password) {
  if (!email?.trim() || !password) throw new Error('Enter your email and password.');
  clearAccessToken();
  await clearStoredSession();
  const data = await authRequest('/auth/login', {
    method: 'POST', body: JSON.stringify({ email: email.trim(), password }),
  }, false);
  if (!data?.token || !data?.user?.id) throw new Error('The school API returned an invalid session.');
  setAccessToken(data.token, data.expiresAt);
  try {
    if (data.user.role === 'student') await authRequest('/students/me');
    await saveSession(data);
    return data.user;
  } catch (error) {
    await logout();
    throw error;
  }
}

export async function validateSession() { return authRequest('/auth/me'); }

export async function restoreSession() {
  const stored = await loadSession();
  if (!stored) return null;
  const deadline = Date.parse(stored.expiresAt);
  if (!Number.isFinite(deadline) || deadline <= Date.now()) {
    clearAccessToken();
    await clearStoredSession();
    return null;
  }
  setAccessToken(stored.token, stored.expiresAt);
  try {
    const user = await validateSession();
    if (!user?.id || !user?.role || user.id !== stored.user.id) {
      throw new Error('The restored school session is invalid.');
    }
    await saveSession({ ...stored, user });
    return user;
  } catch (error) {
    // A 401 clears the in-memory bearer in authRequest. Keep an unexpired
    // stored session during transient connectivity failures, but never admit
    // the user until the server validates it.
    if (!getAuthHeaders().Authorization) await clearStoredSession();
    throw error;
  }
}

export async function logout() {
  // Capture the bearer header before clearing locally, including when offline.
  const pending = authRequest('/auth/logout', { method: 'POST' });
  clearAccessToken();
  await clearStoredSession().catch(() => {});
  try { await pending; return { revoked: true }; }
  catch { return { revoked: false }; }
}
