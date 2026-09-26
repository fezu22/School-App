import { API_URL } from '../config';
let accessToken = '';
let selectedChildId = '';
let selectionVersion = 0;
let childSelectionRequired = false;
let unauthorizedHandler = null;
let invalidChildHandler = null;
export function setAccessToken(token) {
  accessToken = token;
}
export function setSelectedChildId(id) {
  if (selectedChildId !== (id || '')) selectionVersion += 1;
  selectedChildId = id || '';
}
export function setChildSelectionRequired(required) {
  childSelectionRequired = !!required;
}
export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = null;
  };
}
export function onInvalidChildSelection(handler) {
  invalidChildHandler = handler;
  return () => {
    if (invalidChildHandler === handler) invalidChildHandler = null;
  };
}
export async function api(path, method = 'GET', body, options = {}) {
  if (
    childSelectionRequired &&
    !selectedChildId &&
    !(path === '/students' && options.withoutSelectedChild)
  )
    throw Object.assign(
      Error('Choose a linked child before viewing school records.'),
      { code: 'NO_CHILD_SELECTED' },
    );
  const childId = options.withoutSelectedChild ? '' : selectedChildId;
  const requestSelectionVersion = selectionVersion;
  const requestToken = accessToken;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(API_URL + path, {
      method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(childId ? { 'X-School-Child-ID': childId } : {}),
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
    if (childId && requestSelectionVersion !== selectionVersion)
      throw Object.assign(Error('Child selection changed while loading.'), {
        code: 'STALE_CHILD_SELECTION',
      });
    if (!res.ok) {
      if (res.status === 401 && requestToken && requestToken === accessToken)
        unauthorizedHandler?.();
      if (data.code === 'CHILD_NOT_LINKED' && childId) invalidChildHandler?.();
      throw Object.assign(Error(data.error || 'Request failed'), {
        status: res.status,
        code: data.code,
      });
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError')
      throw Error('Request timed out. Check your connection.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
