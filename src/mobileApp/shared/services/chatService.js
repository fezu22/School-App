import { API_ROOT } from './apiConfig';
import { authRequest } from './authRequest';
import { expireSession, getAuthHeaders, subscribeSessionExpiry } from './authSession';

export const MAX_CHAT_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const request = (path, options) => authRequest(`/chat${path}`, options);

function socketRoot() {
  return API_ROOT.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
}

export const chatApi = {
  getTeachers: studentId =>
    request(`/teachers?studentId=${encodeURIComponent(studentId)}`),
  getConversations: (studentId = '') =>
    request(
      `/conversations${studentId ? `?studentId=${encodeURIComponent(studentId)}` : ''}`,
    ),
  startConversation: (studentId, teacherId) =>
    request('/conversations', {
      method: 'POST',
      body: JSON.stringify({ studentId, teacherId }),
    }),
  getMessages: (conversationId, cursor = '') =>
    request(
      `/conversations/${encodeURIComponent(conversationId)}/messages${
        cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
      }`,
    ),
  sendMessage: (conversationId, body, clientMessageId) =>
    request(`/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body, clientMessageId }),
    }),
  uploadAttachment: ({ conversationId, file, body, clientMessageId, onProgress }) =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(
        'POST',
        `${API_ROOT}/chat/conversations/${encodeURIComponent(conversationId)}/attachments`,
      );
      const authorization = getAuthHeaders().Authorization;
      if (authorization) xhr.setRequestHeader('Authorization', authorization);
      xhr.timeout = 120000;
      xhr.upload.onprogress = event => {
        if (event.lengthComputable) onProgress?.(event.loaded, event.total);
      };
      xhr.onerror = () => reject(new Error('Could not reach the school API. Check your connection and try again.'));
      xhr.ontimeout = () => reject(new Error('The image upload timed out. Check your connection and retry.'));
      xhr.onload = () => {
        let payload;
        try { payload = JSON.parse(xhr.responseText); } catch { payload = null; }
        if (xhr.status === 401) expireSession(authorization);
        if (xhr.status < 200 || xhr.status >= 300 || payload?.success !== true) {
          reject(new Error(payload?.error || `Image upload failed (${xhr.status}).`));
          return;
        }
        resolve(payload.data);
      };
      const form = new FormData();
      form.append('file', {
        uri: file.uri,
        type: file.type,
        name: file.name,
      });
      form.append('body', body || '');
      form.append('clientMessageId', clientMessageId);
      xhr.send(form);
    }),
  markRead: conversationId =>
    request(`/conversations/${encodeURIComponent(conversationId)}/read`, {
      method: 'POST',
    }),
  createSocketTicket: () => request('/session', { method: 'POST' }),
};

export function createChatConnection({ onEvent, onStatus }) {
  let active = true;
  let socket = null;
  let retryTimer = null;
  let attempt = 0;
  let expired = false;
  const unsubscribeExpiry = subscribeSessionExpiry(() => {
    expired = true;
    active = false;
    clearTimeout(retryTimer);
    socket?.close();
    onStatus?.('disconnected');
  });

  const scheduleReconnect = () => {
    if (!active || expired || retryTimer) return;
    const base = Math.min(30_000, 800 * 2 ** Math.min(attempt, 6));
    const jitter = Math.floor(Math.random() * Math.min(base / 4, 1500));
    retryTimer = setTimeout(() => {
      retryTimer = null;
      attempt += 1;
      connect();
    }, base + jitter);
    onStatus?.('reconnecting');
  };

  const connect = async () => {
    if (!active || expired) return;
    onStatus?.(attempt ? 'reconnecting' : 'connecting');
    try {
      const response = await chatApi.createSocketTicket();
      if (!active || expired) return;
      const ticket = response?.ticket;
      if (typeof ticket !== 'string') throw new Error('Chat connection ticket was unavailable.');
      const nextSocket = new WebSocket(`${socketRoot()}/chat/socket`, 'school-chat-v1');
      socket = nextSocket;
      let authenticated = false;
      nextSocket.onopen = () => {
        if (active) nextSocket.send(JSON.stringify({ type: 'authenticate', ticket }));
      };
      nextSocket.onmessage = event => {
        let payload;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        if (payload?.type === 'ready') {
          authenticated = true;
          attempt = 0;
          onStatus?.('connected');
          return;
        }
        if (payload?.type === 'message.created' || payload?.type === 'read.receipt')
          onEvent?.(payload);
      };
      nextSocket.onerror = () => {};
      nextSocket.onclose = () => {
        if (socket === nextSocket) socket = null;
        if (active && !expired) {
          onStatus?.(authenticated ? 'reconnecting' : 'reconnecting');
          scheduleReconnect();
        }
      };
    } catch {
      scheduleReconnect();
    }
  };

  connect();
  return {
    close() {
      active = false;
      clearTimeout(retryTimer);
      unsubscribeExpiry();
      socket?.close(1000, 'Inbox closed');
      socket = null;
    },
  };
}

export function createClientMessageId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
