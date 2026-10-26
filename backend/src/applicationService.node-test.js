const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const databasePath = require.resolve('./database');
let assignments;
let users;
let inserted;

require.cache[databasePath] = {
  id: databasePath,
  filename: databasePath,
  loaded: true,
  exports: {
    getDatabase: () => ({
      collection: name => {
        if (name === 'classTeacherAssignments') {
          return {
            find: query => ({
              limit: () => ({
                toArray: async () =>
                  assignments.filter(
                    item =>
                      item.classId === query.classId &&
                      item.active === query.active &&
                      item.status === query.status,
                  ).slice(0, 2),
              }),
            }),
          };
        }
        if (name === 'users') {
          return {
            findOne: async query =>
              users.find(
                user =>
                  user.id === query.id &&
                  user.role === query.role &&
                  user.active !== false,
              ) || null,
          };
        }
        if (name === 'classTeacherApplications') {
          return {
            insertOne: async application => {
              inserted = application;
              return { insertedId: 'mongo-application-id' };
            },
          };
        }
        throw new Error(`Unexpected collection ${name}`);
      },
    }),
  },
};

const {
  createClassTeacherApplication,
  resolveAssignedTeacher,
  validateApplication,
} = require('./applicationService');

beforeEach(() => {
  assignments = [
    {
      classId: 'CLASS-A',
      active: true,
      status: 'assigned',
      teacherUserId: 'teacher-a',
    },
  ];
  users = [{ id: 'teacher-a', role: 'teacher', active: true }];
  inserted = null;
});

test('application validation trims values and enforces required length limits', () => {
  assert.deepEqual(validateApplication({ title: ' Leave ', message: ' Sick ' }), {
    value: { title: 'Leave', message: 'Sick' },
  });
  assert.match(validateApplication({ title: '', message: 'Sick' }).error, /title is required/);
  assert.match(validateApplication({ title: 'Leave', message: '' }).error, /message is required/);
  assert.ok(validateApplication({ title: 'x'.repeat(121), message: 'Sick' }).error);
  assert.ok(validateApplication({ title: 'Leave', message: 'x'.repeat(4001) }).error);
});

test('routing requires exactly one active assignment to an active Teacher user', async () => {
  assert.equal(await resolveAssignedTeacher('CLASS-A'), 'teacher-a');
  users[0].active = false;
  assert.equal(await resolveAssignedTeacher('CLASS-A'), null);
  users[0].active = true;
  users[0].role = 'finance';
  assert.equal(await resolveAssignedTeacher('CLASS-A'), null);
  assignments.push({ ...assignments[0], teacherUserId: 'teacher-b' });
  assert.equal(await resolveAssignedTeacher('CLASS-A'), null);
});

test('created application follows the staff review contract with immutable routing context', async () => {
  const result = await createClassTeacherApplication({
    input: { title: ' Leave request ', message: ' Medical appointment ' },
    applicant: { id: 'student-user' },
    student: { id: '002', classId: 'CLASS-A' },
    applicantRole: 'student',
  });
  assert.equal(result.statusCode, 201);
  assert.equal(inserted.status, 'submitted');
  assert.equal(inserted.studentId, '002');
  assert.equal(inserted.classId, 'CLASS-A');
  assert.equal(inserted.assignedTeacherUserId, 'teacher-a');
  assert.equal(inserted.applicantUserId, 'student-user');
  assert.equal(inserted.applicantRole, 'student');
  assert.deepEqual(inserted.statusHistory.map(entry => entry.status), ['submitted']);
});

test('application creation fails closed when the staff assignment is unavailable', async () => {
  assignments = [];
  const result = await createClassTeacherApplication({
    input: { title: 'Leave', message: 'Medical appointment' },
    applicant: { id: 'parent-user' },
    student: { id: '002', classId: 'CLASS-A' },
    applicantRole: 'parent',
  });
  assert.equal(result.statusCode, 409);
  assert.match(result.error, /No unique active class teacher assignment/);
  assert.equal(inserted, null);
});
