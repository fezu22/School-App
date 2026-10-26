import { API_ROOT } from './apiConfig';
import { expireSession, getAuthHeaders } from './authSession';

export async function authRequest(path, options = {}, authenticated = true, returnEnvelope = false) {
  const authorization = authenticated ? getAuthHeaders().Authorization : undefined;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${API_ROOT}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers,
        ...(authorization ? { Authorization: authorization } : {}),
      },
    });
    if (response.status === 401 && authenticated) expireSession(authorization);
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success !== true) {
      throw new Error(payload?.error || `School API request failed (${response.status}).`);
    }
    return returnEnvelope ? payload : payload.data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The school API timed out. Check your connection and try again.');
    if (error instanceof TypeError) throw new Error('Could not reach the school API. Check your connection and try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
