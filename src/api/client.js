import { API_URL } from '../config';
let accessToken = '';
export function setAccessToken(token) {
  accessToken = token;
}
export async function api(path, method = 'GET', body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(API_URL + path, {
      method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw Error('API did not return JSON. Check the server URL.');
    }
    if (!res.ok)
      throw Object.assign(Error(data.error || 'Request failed'), {
        status: res.status,
        code: data.code,
      });
    return data;
  } catch (e) {
    if (e.name === 'AbortError')
      throw Error('Request timed out. Check your connection.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
