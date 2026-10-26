import {
  parentReferenceNotifications,
  previewNotifications,
} from './previewData';

// Development-only local state. This module never performs database or API writes.
const snapshots = new Map();
const listeners = new Map();
export function getPreviewNotifications(role) {
  if (!snapshots.has(role)) {
    snapshots.set(
      role,
      (role === 'Parent'
        ? parentReferenceNotifications
        : previewNotifications
      ).map(item => ({ ...item })),
    );
  }
  return snapshots.get(role);
}
export function subscribePreviewNotifications(role, callback) {
  if (!listeners.has(role)) listeners.set(role, new Set());
  listeners.get(role).add(callback);
  return () => listeners.get(role).delete(callback);
}
export function markPreviewNotificationsRead(role, ids) {
  const items = getPreviewNotifications(role).map(item =>
    ids.includes(String(item.id || item._id || ''))
      ? { ...item, readAt: item.readAt || new Date().toISOString() }
      : item,
  );
  snapshots.set(role, items);
  listeners.get(role)?.forEach(callback => callback(items));
  return items;
}
