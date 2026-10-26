const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const {
  IntegrationReferenceError,
  apiId,
  assertSameBranch,
  referenceValues,
  resolveBranchReference,
  resolveRecordReference,
  resolveUserReference,
  resolveUserForRole,
  unresolvedClassReference,
} = require('./identityReferenceAdapter');

function matchesValue(actual, expected) {
  if (expected && typeof expected === 'object' && !(expected instanceof ObjectId)) {
    if ('$in' in expected) return expected.$in.some(value => matchesValue(actual, value));
    return Object.entries(expected).every(([key, value]) => {
      if (key === '$ne') return actual !== value;
      return false;
    });
  }
  if (actual instanceof ObjectId || expected instanceof ObjectId) {
    return String(actual) === String(expected);
  }
  return actual === expected;
}

function matches(row, query) {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$or') return value.some(part => matches(row, part));
    return matchesValue(row[key], value);
  });
}

function database(seed) {
  return {
    collection(name) {
      const rows = seed[name] || [];
      return {
        find(query) {
          let selected = rows.filter(row => matches(row, query));
          return {
            limit(count) { selected = selected.slice(0, count); return this; },
            toArray: async () => selected,
          };
        },
        findOne: async query => rows.find(row => matches(row, query)) || null,
      };
    },
  };
}

test('explicit legacy users.id aliases resolve and remain the API ID', async () => {
  const id = new ObjectId();
  const db = database({ users: [{ _id: id, id: 'legacy-student-7', role: 'student' }] });
  const user = await resolveUserReference(db, 'legacy-student-7');
  assert.equal(user.id, 'legacy-student-7');
  assert.equal(apiId(user), 'legacy-student-7');
});

test('valid users._id ObjectIds resolve even when the explicit alias is absent', async () => {
  const id = new ObjectId();
  const db = database({ users: [{ _id: id, role: 'parent' }] });
  const user = await resolveUserReference(db, id.toHexString());
  assert.equal(String(user._id), id.toHexString());
  assert.equal(apiId(user), id.toHexString());
  assert.deepEqual(referenceValues(user), [id, id.toHexString()]);
});

test('missing references return a clear integration error', async () => {
  await assert.rejects(
    resolveUserReference(database({ users: [] }), 'not-present'),
    error => error instanceof IntegrationReferenceError &&
      error.code === 'INTEGRATION_REFERENCE_UNRESOLVED' &&
      /does not resolve/.test(error.message),
  );
});

test('persisted role mismatches are denied even when the trusted context claims another role', async () => {
  const db = database({ users: [{ _id: new ObjectId(), id: 'finance-1', role: 'finance' }] });
  await assert.rejects(
    resolveUserForRole(db, 'finance-1', 'student'),
    error => error.code === 'ROLE_ACCESS_DENIED' && error.statusCode === 403,
  );
});

test('a legacy alias colliding with another record ObjectId is rejected as ambiguous', async () => {
  const objectIdOwner = { _id: new ObjectId('aaaaaaaaaaaaaaaaaaaaaaaa'), role: 'parent' };
  const aliasOwner = { _id: new ObjectId(), id: objectIdOwner._id.toHexString(), role: 'student' };
  await assert.rejects(
    resolveUserReference(database({ users: [aliasOwner, objectIdOwner] }), objectIdOwner._id.toHexString()),
    error => error.code === 'INTEGRATION_REFERENCE_CONFLICT' && error.statusCode === 409,
  );
});

test('branch isolation resolves real branch records and denies cross-branch access', async () => {
  const north = new ObjectId();
  const south = new ObjectId();
  const db = database({ branches: [{ _id: north }, { _id: south }] });
  assert.equal(String((await resolveBranchReference(db, north.toHexString()))._id), north.toHexString());
  await assert.rejects(
    assertSameBranch(db, north.toHexString(), south),
    error => error.code === 'BRANCH_ACCESS_DENIED' && error.statusCode === 403,
  );
});

test('unresolved branch and class-shaped references are never guessed', async () => {
  await assert.rejects(
    resolveBranchReference(database({ branches: [] }), 'NORTH'),
    error => error.code === 'INTEGRATION_REFERENCE_UNRESOLVED' && /Branch reference/.test(error.message),
  );
  await assert.rejects(
    resolveRecordReference(database({ students: [] }), 'students', 'CLASS-A', { label: 'Student' }),
    error => error.code === 'INTEGRATION_REFERENCE_UNRESOLVED',
  );
  assert.throws(
    unresolvedClassReference,
    error => error.code === 'INTEGRATION_REFERENCE_UNRESOLVED' &&
      /canonical class collection\/ID mapping/.test(error.message),
  );
});
