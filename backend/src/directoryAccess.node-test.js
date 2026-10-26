const test = require('node:test');
const assert = require('node:assert/strict');
const { __test } = require('./routes');

test('Student directory filters bind Student accounts to their own linked record', () => {
  assert.deepEqual(
    __test.studentDirectoryFilter(
      { id: 'student-user-a', role: 'student' },
      [],
      '002',
    ),
    { userId: 'student-user-a', id: '002' },
  );
  assert.equal(
    __test.studentDirectoryFilter({ id: 'teacher-a', role: 'teacher' }, [], '002'),
    null,
  );
});

test('Parent student filters contain only verified linked student IDs', () => {
  assert.deepEqual(
    __test.studentDirectoryFilter(
      { id: 'parent-a', role: 'parent' },
      ['002'],
    ),
    { id: { $in: ['002'] } },
  );
  assert.deepEqual(
    __test.studentDirectoryFilter(
      { id: 'parent-a', role: 'parent' },
      ['002'],
      '003',
    ),
    { id: { $in: [] } },
  );
});

test('Finance student filters always include the trusted branch', () => {
  assert.deepEqual(
    __test.studentDirectoryFilter(
      { id: 'finance-a', role: 'finance', branchId: 'branch-a' },
      [],
      '002',
    ),
    { branchId: 'branch-a', id: '002' },
  );
  assert.equal(
    __test.studentDirectoryFilter({ id: 'finance-a', role: 'finance' }, [], '002'),
    null,
  );
});

test('Parent profiles are self-only and Finance parents require branch-derived links', () => {
  assert.deepEqual(
    __test.parentDirectoryFilter(
      { id: 'parent-a', role: 'parent' },
      ['parent-a'],
      'parent-b',
    ),
    {
      $and: [
        { $or: [{ id: 'parent-a' }, { userId: 'parent-a' }] },
        { $or: [{ id: 'parent-b' }, { userId: 'parent-b' }] },
      ],
    },
  );
  assert.deepEqual(
    __test.parentDirectoryFilter(
      { id: 'finance-a', role: 'finance', branchId: 'branch-a' },
      ['parent-a'],
      'parent-b',
    ),
    {
      $and: [
        {
          $or: [
            { id: { $in: ['parent-a'] } },
            { userId: { $in: ['parent-a'] } },
          ],
        },
        { $or: [{ id: 'parent-b' }, { userId: 'parent-b' }] },
      ],
    },
  );
});

test('verified link filters exclude revoked and unverified relationships', () => {
  assert.deepEqual(__test.verifiedDirectoryLinkFilter('parent-a', ['002']), {
    parentUserId: 'parent-a',
    studentId: { $in: ['002'] },
    revokedAt: null,
    status: { $ne: 'revoked' },
    $or: [{ status: 'verified' }, { verified: true }],
  });
});

test('directory projections omit authentication and unrestricted record fields', () => {
  for (const projection of [
    __test.SAFE_STUDENT_DIRECTORY_FIELDS,
    __test.SAFE_PARENT_DIRECTORY_FIELDS,
  ]) {
    assert.equal(projection.passwordHash, undefined);
    assert.equal(projection.passwordSalt, undefined);
    assert.equal(projection.studentIds, undefined);
    assert.equal(projection._id, 0);
  }
});

test('directory search escapes regex operators and retains the access filter', () => {
  const access = { branchId: 'branch-a' };
  const searched = __test.appendDirectorySearch(access, '.*');
  assert.deepEqual(searched.filter.$and[0], access);
  assert.equal(searched.filter.$and[1].$or[0].id.$regex, '\\.\\*');
  assert.match(__test.appendDirectorySearch(access, 'x'.repeat(101)).error, /too long/);
});
