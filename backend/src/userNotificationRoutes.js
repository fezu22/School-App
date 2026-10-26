const express = require('express');
const { ObjectId } = require('mongodb');
const { getDatabase } = require('./database');

function notificationIdentity(id) {
  const identity = [{ id }];
  if (ObjectId.isValid(id)) identity.push({ _id: new ObjectId(id) });
  return identity;
}

function recipientFilter(userId, role) {
  return { recipientUserId: userId, recipientRole: role };
}

function createUserNotificationRouter(role) {
  const router = express.Router();

  router.use((req, res, next) => {
    const userId = typeof req.user?.id === 'string' ? req.user.id.trim() : '';
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, error: 'Trusted user context is required.' });
    }
    if (req.user.role !== role) {
      return res
        .status(403)
        .json({ success: false, error: `${role} access is required.` });
    }
    req.notificationRecipient = recipientFilter(userId, role);
    return next();
  });

  router.get('/', async (req, res, next) => {
    try {
      const collection = getDatabase().collection('notifications');
      const recipient = req.notificationRecipient;
      const [data, unreadCount] = await Promise.all([
        collection.find(recipient).sort({ createdAt: -1 }).limit(100).toArray(),
        collection.countDocuments({ ...recipient, readAt: null }),
      ]);
      return res.json({
        success: true,
        data: { notifications: data, unreadCount },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:notificationId', async (req, res, next) => {
    try {
      const id = req.params.notificationId;
      const identity = notificationIdentity(id);
      const notification = await getDatabase()
        .collection('notifications')
        .findOne({ ...req.notificationRecipient, $or: identity });
      if (!notification) {
        return res
          .status(404)
          .json({ success: false, error: 'Notification was not found.' });
      }
      return res.json({ success: true, data: notification });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:notificationId/read', async (req, res, next) => {
    try {
      const id = req.params.notificationId;
      const identity = notificationIdentity(id);
      const result = await getDatabase()
        .collection('notifications')
        .updateOne(
          { ...req.notificationRecipient, $or: identity, readAt: null },
          { $set: { readAt: new Date() } },
        );
      if (!result.matchedCount) {
        const exists = await getDatabase()
          .collection('notifications')
          .findOne({ ...req.notificationRecipient, $or: identity });
        if (!exists) {
          return res
            .status(404)
            .json({ success: false, error: 'Notification was not found.' });
        }
      }
      return res.json({ success: true, data: { read: true } });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = {
  createUserNotificationRouter,
  __test: { notificationIdentity, recipientFilter },
};
