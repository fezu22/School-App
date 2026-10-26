let accessToken = '';
let expiresAt = 0;
const listeners = new Set();
export function setAccessToken(token, expiry) {
  accessToken = token || '';
  expiresAt = expiry ? Date.parse(expiry) : 0;
}
export function clearAccessToken() { accessToken = ''; expiresAt = 0; }
export function getAuthHeaders() { return accessToken ? { Authorization: `Bearer ${accessToken}` } : {}; }
export function getSessionExpiry() { return expiresAt; }
export function subscribeSessionExpiry(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function expireSession(authorization) {
  // Ignore delayed failures from an older session.
  if (!authorization || authorization !== getAuthHeaders().Authorization) return;
  clearAccessToken();
  listeners.forEach(listener => listener());
}
export function checkSessionExpiry() {
  if (expiresAt && Date.now() >= expiresAt) expireSession(getAuthHeaders().Authorization);
}
