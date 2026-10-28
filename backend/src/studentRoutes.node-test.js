const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const { ObjectId } = require('mongodb');

const databasePath = require.resolve('./database');
let linkedStudent;
let studentLookup;
let otherBranchId;
let currentStudentUser;
const schoolAId = new ObjectId();
const schoolBId = new ObjectId();
const studentBranchId = new ObjectId();
const studentUser = {
  _id: new ObjectId(),
  id: 'user-002',
  role: 'student',
  schoolId: schoolAId.toHexString(),
  branchId: studentBranchId.toHexString(),
};

function matchesValue(actual, expected) {
  if (expected && typeof expected === 'object' && !(expected instanceof ObjectId)) {
    if ('$in' in expected) return expected.$in.some(item => matchesValue(actual, item));
    return false;
  }
  if (actual instanceof ObjectId || expected instanceof ObjectId) return String(actual) === String(expected);
  return actual === expected;
}

function matches(row, query) {
  return Object.entries(query).every(([key, expected]) => {
    if (key === '$or') return expected.some(part => matches(row, part));
    return matchesValue(row[key], expected);
  });
}

require.cache[databasePath] = {
  id: databasePath,
  filename: databasePath,
  loaded: true,
  exports: {
    getDatabase: () => ({
      collection: name => ({
        find: query => {
          if (name === 'users') return cursor([currentStudentUser].filter(row => row && matches(row, query)));
          if (name === 'students') {
            studentLookup = query;
            return cursor(linkedStudent && matches(linkedStudent, query) ? [linkedStudent] : []);
          }
          throw new Error(`Unexpected collection ${name}`);
        },
        findOne: async query => {
          if (name === 'schools') {
            if (String(query._id) === String(schoolAId)) return { _id: schoolAId, isActive: true, status: 'active' };
            if (String(query._id) === String(schoolBId)) return { _id: schoolBId, isActive: true, status: 'active' };
            return null;
          }
          if (name !== 'branches') return null;
          const branch = [studentBranchId, otherBranchId].find(id => id && String(query._id) === String(id));
          return branch ? { _id: branch, schoolId: schoolAId, isActive: true } : null;
        },
      }),
    }),
  },
};

const {
  MAX_SUBMISSION_FILE_BYTES,
  ownedStudentFilter,
  publishedFilter,
  requireStudentContext,
  submissionDeadline,
  studentClassFilter,
  validateSubmissionFile,
} = require('./studentRoutes').__test;

beforeEach(() => {
  currentStudentUser = { ...studentUser };
  linkedStudent = {
    _id: new ObjectId(),
    id: '002',
    userId: 'user-002',
    classId: 'CLASS-A',
    schoolId: schoolAId.toHexString(),
    branchId: studentBranchId.toHexString(),
  };
  studentLookup = null;
  otherBranchId = null;
});

function cursor(rows) {
  let selected = rows;
  return {
    limit(count) { selected = selected.slice(0, count); return this; },
    toArray: async () => selected,
  };
}

function authorize(user) {
  return new Promise((resolve, reject) => {
    const req = { user };
    let status = 200;
    let payload;
    const res = {
      status(code) {
        status = code;
        return res;
      },
      json(value) {
        payload = value;
        resolve({ req, status, payload, passed: false });
        return res;
      },
    };
    requireStudentContext(req, res, error => {
      if (error) reject(error);
      else resolve({ req, status, payload, passed: true });
    });
  });
}

test('student context is resolved only from the authenticated user id', async () => {
  const result = await authorize({ id: 'user-002', role: 'student' });
  assert.equal(result.passed, true);
  assert.deepEqual(studentLookup, { userId: { $in: ['user-002', studentUser._id, studentUser._id.toHexString()] } });
  assert.equal(result.req.studentRecord.id, '002');
});

test('another role cannot enter Student routes', async () => {
  const result = await authorize({ id: 'finance-user', role: 'finance' });
  assert.equal(result.status, 403);
  assert.equal(result.passed, false);
  assert.equal(studentLookup, null);
});

test('an unlinked Student account is rejected', async () => {
  linkedStudent = null;
  await assert.rejects(
    authorize({ id: 'user-002', role: 'student' }),
    error => error.code === 'INTEGRATION_REFERENCE_UNRESOLVED' && error.statusCode === 503,
  );
});

test('Student access is denied when the persisted user and Student branch records differ', async () => {
  otherBranchId = new ObjectId();
  linkedStudent.branchId = otherBranchId.toHexString();
  await assert.rejects(
    authorize({ id: 'user-002', role: 'student' }),
    error => error.code === 'BRANCH_ACCESS_DENIED' && error.statusCode === 403,
  );
});

test('Student access fails closed when schoolId is missing or when Student record belongs to another school', async () => {
  delete currentStudentUser.schoolId;
  await assert.rejects(
    authorize({ id: 'user-002', role: 'student' }),
    error => error.code === 'INTEGRATION_SCHOOL_SCOPE_REQUIRED' && error.statusCode === 503,
  );

  currentStudentUser.schoolId = schoolAId.toHexString();
  linkedStudent.schoolId = schoolBId.toHexString();
  await assert.rejects(
    authorize({ id: 'user-002', role: 'student' }),
    error => error.code === 'SCHOOL_ACCESS_DENIED' && error.statusCode === 403,
  );
});

test('owned record filters cannot be redirected to another student', () => {
  const filter = ownedStudentFilter(
    { id: '002' },
    { studentId: 'OTHER', subject: 'Mathematics' },
  );
  assert.equal(filter.studentId, '002');
  assert.equal(filter.subject, 'Mathematics');
});

test('results and progress require both ownership and publication', () => {
  const filter = ownedStudentFilter({ id: '002' }, publishedFilter());
  assert.equal(filter.studentId, '002');
  assert.deepEqual(filter.$or, [
    { published: true },
    { status: 'published' },
  ]);
});

test('timetable scope is derived from the linked Student record', () => {
  assert.deepEqual(studentClassFilter(linkedStudent), {
    $or: [
      { studentId: '002' },
      { studentIds: '002' },
      { classId: 'CLASS-A' },
    ],
  });
});

test('homework deadlines use the end of a date-only due date', () => {
  const result = submissionDeadline('2026-10-07');
  assert.equal(result.error, undefined);
  assert.equal(result.deadline.toISOString(), '2026-10-07T23:59:59.999Z');
  assert.match(submissionDeadline('not-a-date').error, /invalid deadline/i);
});

test('homework uploads are capped at exactly 5 MB', () => {
  assert.equal(MAX_SUBMISSION_FILE_BYTES, 5 * 1024 * 1024);
});

test('homework file validation accepts matching signatures only', () => {
  const pdf = validateSubmissionFile({
    originalname: 'answer.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7 real content'),
  });
  assert.equal(pdf.error, undefined);
  assert.equal(pdf.type.mime, 'application/pdf');

  const spoofed = validateSubmissionFile({
    originalname: 'answer.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from('not a pdf'),
  });
  assert.match(spoofed.error, /content, extension, and MIME type/i);

  const mismatched = validateSubmissionFile({
    originalname: 'answer.png',
    mimetype: 'image/jpeg',
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
  });
  assert.match(mismatched.error, /must match/i);
});

