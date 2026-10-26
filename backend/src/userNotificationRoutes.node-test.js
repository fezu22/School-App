const test = require('node:test');
const assert = require('node:assert/strict');
const { __test } = require('./userNotificationRoutes');

test('notification recipient filter binds both authenticated user and role', () => {
  assert.deepEqual(__test.recipientFilter('student-user', 'student'), {
    recipientUserId: 'student-user',
    recipientRole: 'student',
  });
  assert.notDeepEqual(
    __test.recipientFilter('other-user', 'student'),
    __test.recipientFilter('student-user', 'student'),
  );
});

test('notification identities accept exact public IDs and valid database IDs only', () => {
  assert.deepEqual(__test.notificationIdentity('notice-1'), [{ id: 'notice-1' }]);
  const identity = __test.notificationIdentity('507f1f77bcf86cd799439011');
  assert.equal(identity.length, 2);
  assert.equal(identity[0].id, '507f1f77bcf86cd799439011');
  assert.equal(String(identity[1]._id), '507f1f77bcf86cd799439011');
});
