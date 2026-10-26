const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');
const { getDatabase } = require('./database');

const RECIPIENT_ROLES = new Set(['student', 'parent', 'finance']);
const MAX_TITLE_LENGTH = 160;
const MAX_BODY_LENGTH = 1200;

async function createRecipientNotification(input) {
  const recipientUserId =
    typeof input?.recipientUserId === 'string'
      ? input.recipientUserId.trim()
      : '';
  const recipientRole = input?.recipientRole;
  const title = typeof input?.title === 'string' ? input.title.trim() : '';
  const body = typeof input?.body === 'string' ? input.body.trim() : '';
  const targetType =
    typeof input?.targetType === 'string' ? input.targetType.trim() : '';
  const targetId =
    typeof input?.targetId === 'string' ? input.targetId.trim() : '';

  if (!recipientUserId || !RECIPIENT_ROLES.has(recipientRole)) {
    throw new TypeError('A valid recipient user ID and role are required.');
  }
  if (!title || title.length > MAX_TITLE_LENGTH) {
    throw new TypeError(
      `Notification title must be 1-${MAX_TITLE_LENGTH} characters.`,
    );
  }
  if (!body || body.length > MAX_BODY_LENGTH) {
    throw new TypeError(
      `Notification body must be 1-${MAX_BODY_LENGTH} characters.`,
    );
  }
  if (
    !targetType ||
    !targetId ||
    !input.recordSnapshot ||
    typeof input.recordSnapshot !== 'object' ||
    Array.isArray(input.recordSnapshot)
  ) {
    throw new TypeError(
      'Notifications require an exact target type, target ID, and source record snapshot.',
    );
  }
  if (
    Buffer.byteLength(JSON.stringify(input.recordSnapshot), 'utf8') > 24_000
  ) {
    throw new TypeError('Notification source snapshots must not exceed 24 KB.');
  }

  const notification = {
    id: crypto.randomUUID(),
    recipientUserId,
    recipientRole,
    title,
    body,
    targetType,
    targetId,
    recordSnapshot: input.recordSnapshot,
    createdAt: new Date(),
    readAt: null,
  };
  await getDatabase().collection('notifications').insertOne(notification);
  return notification;
}

module.exports = { createRecipientNotification };
