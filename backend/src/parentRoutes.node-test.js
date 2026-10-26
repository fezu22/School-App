const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

const databasePath = require.resolve('./database');
let links;
let students;
let lastLinkQuery;
let studentLookupCount;
const parentBranchId = new ObjectId();
const parentBranch = { _id: parentBranchId };
const parentUsers = [
  { _id: new ObjectId(), id: 'parent-a', role: 'parent', branchId: parentBranchId.toHexString() },
  { _id: new ObjectId(), id: 'parent-b', role: 'parent', branchId: parentBranchId.toHexString() },
];

function matchesValue(actual, expected) {
  if (expected && typeof expected === 'object' && !(expected instanceof ObjectId)) {
    if ('$in' in expected) return expected.$in.some(item => matchesValue(actual, item));
    if ('$ne' in expected) return actual !== expected.$ne;
    return false;
  }
  if (actual instanceof ObjectId || expected instanceof ObjectId) return String(actual) === String(expected);
  return actual === expected;
}

function matches(row, query) {
  return Object.entries(query).every(([key, expected]) => {
    if (key === '$or') return expected.some(part => matches(row, part));
    if (key === '$and') return expected.every(part => matches(row, part));
    return matchesValue(row[key], expected);
  });
}

function cursor(rows) {
  let selected = rows;
  return {
    limit(count) { selected = selected.slice(0, count); return this; },
    toArray: async () => selected,
  };
}

require.cache[databasePath] = {
  id: databasePath,
  filename: databasePath,
  loaded: true,
  exports: {
    getDatabase: () => ({
      collection: name => ({
        find: query => {
          if (name === 'parentChildLinks') {
            lastLinkQuery = query;
            return cursor(links.filter(link => matches(link, query)));
          }
          if (name === 'students') {
            studentLookupCount += 1;
            return cursor(students.filter(student => matches(student, query)));
          }
          if (name === 'users') return cursor(parentUsers.filter(user => matches(user, query)));
          throw new Error(`Unexpected collection ${name}`);
        },
        findOne: async query => {
          if (name === 'parentChildLinks') {
            lastLinkQuery = query;
            return links.find(link => matches(link, query)) || null;
          }
          if (name === 'students') {
            studentLookupCount += 1;
            return students.find(student => matches(student, query)) || null;
          }
          if (name === 'branches') return String(query._id) === String(parentBranchId) ? parentBranch : null;
          throw new Error(`Unexpected collection ${name}`);
        },
      }),
    }),
  },
};

const {
  getVerifiedChild,
  listVerifiedChildren,
  ownedChildFilter,
  publishedFilter,
  requireParentContext,
  verifiedLinkFilter,
} = require('./parentRoutes').__test;

beforeEach(() => {
  links = [
    {
      parentUserId: 'parent-a',
      studentId: '002',
      status: 'verified',
      verified: true,
      revokedAt: null,
    },
    {
      parentUserId: 'parent-b',
      studentId: '003',
      status: 'verified',
      verified: true,
      revokedAt: null,
    },
  ];
  students = [
    { _id: new ObjectId(), id: '002', fullName: 'Student Two', classId: 'CLASS-A', branchId: parentBranchId.toHexString() },
    { _id: new ObjectId(), id: '003', fullName: 'Student Three', classId: 'CLASS-B', branchId: parentBranchId.toHexString() },
  ];
  lastLinkQuery = null;
  studentLookupCount = 0;
  links[0].parentUserId = 'parent-a';
  links[1].parentUserId = 'parent-b';
});

test('verified link filters bind both parent and child and exclude revocations', () => {
  assert.deepEqual(verifiedLinkFilter('parent-a', '002'), {
    parentUserId: 'parent-a',
    studentId: '002',
    revokedAt: null,
    status: { $ne: 'revoked' },
    $or: [{ status: 'verified' }, { verified: true }],
  });
});

test('a parent can resolve their own verified child', async () => {
  const child = await getVerifiedChild('parent-a', '002');
  assert.equal(child.id, '002');
  assert.deepEqual(JSON.parse(JSON.stringify(child)), {
    id: '002',
    fullName: 'Student Two',
    classId: 'CLASS-A',
  });
  assert.deepEqual(lastLinkQuery.$and, [{ $or: [{ studentId: '002' }] }]);
  assert.equal(studentLookupCount, 2);
});

test('listing children ignores unrelated broken Parent links without widening ownership', async () => {
  links.push({
    parentUserId: 'unmapped-parent-reference',
    studentId: '003',
    status: 'verified',
    verified: true,
    revokedAt: null,
  });

  const children = await listVerifiedChildren(parentUsers[0]);

  assert.deepEqual(children.map(child => child.id), ['002']);
  assert.deepEqual(lastLinkQuery.parentUserId.$in, [
    'parent-a',
    parentUsers[0]._id,
    parentUsers[0]._id.toHexString(),
  ]);
});

test('another parent cannot resolve a child they are not linked to', async () => {
  const child = await getVerifiedChild('parent-b', '002');
  assert.equal(child, null);
  assert.equal(studentLookupCount, 0);
});

test('verified parent-child references resolve exact ObjectId links without changing the API student ID', async () => {
  const childId = students[0]._id;
  links[0].parentUserId = parentUsers[0]._id;
  links[0].studentId = childId;
  const child = await getVerifiedChild('parent-a', childId.toHexString());
  assert.equal(child.id, '002');
});

test('a broken parent reference returns an integration error and denies the child', async () => {
  links[0].parentUserId = 'unmapped-parent-reference';
  await assert.rejects(
    getVerifiedChild('parent-a', '002'),
    error => error.code === 'INTEGRATION_REFERENCE_UNRESOLVED' && error.statusCode === 503,
  );
});

test('revoked and unverified links cannot resolve a child', async () => {
  links[0] = { ...links[0], revokedAt: new Date(), status: 'revoked', verified: false };
  assert.equal(await getVerifiedChild('parent-a', '002'), null);
  assert.equal(studentLookupCount, 0);
});

test('revoked status wins over a stale legacy verified flag', async () => {
  links[0] = { ...links[0], status: 'revoked', verified: true, revokedAt: null };
  assert.equal(await getVerifiedChild('parent-a', '002'), null);
  assert.equal(studentLookupCount, 0);
});

test('child record filters cannot be redirected to another student', () => {
  const filter = ownedChildFilter(
    { id: '002' },
    { studentId: '003', ...publishedFilter() },
  );
  assert.equal(filter.studentId, '002');
  assert.deepEqual(filter.$or, [
    { published: true },
    { status: 'published' },
  ]);
});

test('non-parent roles cannot enter Parent routes', () => {
  const req = { user: { id: 'finance-user', role: 'finance' } };
  let status = 200;
  let passed = false;
  const res = {
    status(code) {
      status = code;
      return res;
    },
    json() {
      return res;
    },
  };
  requireParentContext(req, res, () => {
    passed = true;
  });
  assert.equal(status, 403);
  assert.equal(passed, false);
});
