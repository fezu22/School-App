import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { Server } from 'node:http';
import { fork, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import app from '../src/staff/src/app';
import Branch from '../src/staff/src/models/branch';
import User, { type UserRole } from '../src/staff/src/models/user';
import Session from '../src/staff/src/models/session';
import Student from '../src/staff/src/models/student';
import SchoolClass from '../src/staff/src/models/schoolClass';
import Section from '../src/staff/src/models/section';
import Subject from '../src/staff/src/models/subject';
import TeacherAssignment from '../src/staff/src/models/teacherAssignment';
import { StudentEnrollment } from '../src/staff/src/models/studentEnrollment';
import ApprovalRequest from '../src/staff/src/models/approvalRequest';
import {
  StaffLeave,
  StaffPayslip,
  StaffDocument,
  StaffAppointment,
  ensureStaffSelfServiceIndexes,
} from '../src/staff/src/models/staffSelfService';
import { PERMISSIONS } from '../src/staff/src/constants/permissions';
import { ROLE_PERMISSIONS } from '../src/staff/src/constants/rolePermissions';
import { generateAccessToken } from '../src/staff/src/services/jwt.service';
import { registerSession } from '../src/staff/src/services/session.service';
import {
  addScheduleDays,
  schoolToday,
} from '../src/staff/src/services/school-date.service';
import { documentExpiryStatus } from '../src/staff/src/services/staff-self-service.service';

let db: MongoMemoryReplSet,
  server: Server,
  worker: ChildProcess,
  base: string,
  second: string;
type Actor = { id: string; token: string };
let branch: string,
  foreign: string,
  teacher: Actor,
  other: Actor,
  outsider: Actor,
  principal: Actor,
  student: Actor;
const oid = () => new mongoose.Types.ObjectId(),
  root = '/teacher/self-service';
const oldSecret = process.env.JWT_SECRET,
  oldAuthority = process.env.PRINCIPAL_APPROVAL_AUTHORITY;
const grants = [...ROLE_PERMISSIONS.teacher];
test('self-service grants are Teacher-only and never grant administrative authority', () => {
  const self = Object.values(PERMISSIONS).filter(p => p.startsWith('staff.'));
  assert.equal(self.length, 6);
  for (const p of self) {
    assert.ok(ROLE_PERMISSIONS.teacher.includes(p));
    for (const role of ['principal', 'super_admin', 'student'] as const)
      assert.equal(ROLE_PERMISSIONS[role].includes(p), false);
  }
});
const actor = async (role: UserRole, branchId: string) => {
  const user = await new User({
    fullName: `${role} Person`,
    email: `${oid()}@test.invalid`,
    password: 'fixture-password',
    role,
    branchId,
  }).save();
  const token = generateAccessToken(String(user._id), role);
  await registerSession(String(user._id), token, role);
  return { id: String(user._id), token };
};
const http = async (
  path: string,
  who = teacher,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
  endpoint = base,
) => {
  const response = await fetch(endpoint + path, {
    method,
    headers: {
      Authorization: `Bearer ${who.token}`,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  return {
    status: response.status,
    data: response.headers.get('content-type')?.includes('json')
      ? (JSON.parse(raw).data as any)
      : null,
    raw,
    headers: response.headers,
  };
};
const day = () => addScheduleDays(schoolToday(), 2);
const leave = (extra = {}) => ({
  leaveType: 'personal',
  startDate: day(),
  endDate: addScheduleDays(day(), 1),
  reason: 'Family commitment',
  clientOperationId: 'leave_operation_00001',
  ...extra,
});
const slot = (extra = {}) => ({
  title: 'Family consultation',
  date: day(),
  startTime: '10:00',
  endTime: '11:00',
  clientOperationId: 'slot_operation_00001',
  ...extra,
});
const change = (extra = {}) => ({
  revision: 1,
  clientOperationId: 'change_operation_00001',
  ...extra,
});
const createSlot = async (extra = {}) => {
  const r = await http(root + '/appointments/slots', teacher, slot(extra));
  assert.equal(r.status, 200, r.raw);
  return r.data;
};
before(async () => {
  process.env.JWT_SECRET = 'staff-self-service-owned-secret';
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri(), { autoIndex: false });
  await ensureStaffSelfServiceIndexes();
  await TeacherAssignment.createIndexes();
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(done => server.once('listening', done));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  worker = fork(
    resolve(__dirname, 'helpers/academic-setup-worker.ts'),
    [db.getUri()],
    { execArgv: ['--import', 'tsx'], silent: true },
  );
  second = await new Promise<string>((done, fail) => {
    const timer = setTimeout(
      () => fail(new Error('Worker startup timeout')),
      20000,
    );
    worker.on('message', (m: any) => {
      if (m.type === 'ready') {
        clearTimeout(timer);
        done(m.base);
      }
      if (m.type === 'failure') {
        clearTimeout(timer);
        fail(new Error(m.message));
      }
    });
    worker.once('error', e => {
      clearTimeout(timer);
      fail(e);
    });
  });
});
beforeEach(async () => {
  ROLE_PERMISSIONS.teacher = [...grants];
  for (const model of Object.values(mongoose.models))
    await model.collection.deleteMany({});
  branch = String(
    (
      await Branch.create({
        name: 'Main',
        code: 'MAIN',
        address: 'Fixture',
        city: 'Fixture',
      })
    )._id,
  );
  foreign = String(
    (
      await Branch.create({
        name: 'Foreign',
        code: 'FOREIGN',
        address: 'Fixture',
        city: 'Fixture',
      })
    )._id,
  );
  teacher = await actor('teacher', branch);
  other = await actor('teacher', branch);
  outsider = await actor('teacher', foreign);
  principal = await actor('principal', branch);
  student = await actor('student', branch);
  process.env.PRINCIPAL_APPROVAL_AUTHORITY = JSON.stringify({
    [principal.id]: { branchId: branch, types: ['leave'] },
  });
});
after(async () => {
  ROLE_PERMISSIONS.teacher = grants;
  if (worker?.connected) {
    const done = new Promise<void>(r => worker.once('exit', () => r()));
    worker.send('shutdown');
    await done;
  }
  if (server) await new Promise<void>(done => server.close(() => done()));
  await mongoose.disconnect();
  if (db) await db.stop();
  if (oldSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = oldSecret;
  if (oldAuthority === undefined)
    delete process.env.PRINCIPAL_APPROVAL_AUTHORITY;
  else process.env.PRINCIPAL_APPROVAL_AUTHORITY = oldAuthority;
});
test('own leave, truthful unknown balance and cross-user isolation', async () => {
  const r = await http(root + '/leave', teacher, leave());
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.data.status, 'pending');
  const list = await http(root + '/leave');
  assert.equal(list.data.items.length, 1);
  assert.equal(list.data.balances[0].available, null);
  assert.equal(list.data.balances[0].pendingDays, 2);
  assert.equal((await http(root + '/leave', other)).data.items.length, 0);
  assert.equal((await http(root + '/leave', outsider)).data.items.length, 0);
});
test('leave retry is idempotent and changed operation payload is rejected', async () => {
  const a = await http(root + '/leave', teacher, leave()),
    b = await http(root + '/leave', teacher, leave());
  assert.equal(a.status, 200);
  assert.equal(b.data.leaveId, a.data.leaveId);
  assert.equal(await StaffLeave.countDocuments(), 1);
  assert.equal(await ApprovalRequest.countDocuments(), 1);
  assert.equal(
    (
      await http(
        root + '/leave',
        teacher,
        leave({ reason: 'Different reason' }),
      )
    ).status,
    409,
  );
});
test('overlapping and duplicate leave requests rejected', async () => {
  await http(root + '/leave', teacher, leave());
  assert.equal(
    (
      await http(
        root + '/leave',
        teacher,
        leave({ clientOperationId: 'leave_operation_00002' }),
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await http(
        root + '/leave',
        teacher,
        leave({
          startDate: addScheduleDays(day(), 1),
          clientOperationId: 'leave_operation_00003',
        }),
      )
    ).status,
    409,
  );
});
test('two API instances serialize simultaneous overlapping leave requests', async () => {
  const responses = await Promise.all([
    http(root + '/leave', teacher, leave()),
    http(
      root + '/leave',
      teacher,
      leave({ clientOperationId: 'second_leave_operation_01' }),
      'POST',
      second,
    ),
  ]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal(await StaffLeave.countDocuments(), 1);
  assert.equal(await ApprovalRequest.countDocuments(), 1);
});
test('simultaneous identical leave retries converge on one request', async () => {
  const responses = await Promise.all([
    http(root + '/leave', teacher, leave()),
    http(root + '/leave', teacher, leave(), 'POST', second),
  ]);
  assert.deepEqual(
    responses.map(r => r.status),
    [200, 200],
  );
  assert.equal(responses[0].data.leaveId, responses[1].data.leaveId);
});
for (const extra of [
  { startDate: '2026-02-30' },
  { endDate: '2026-01-01' },
  { startDate: 'yesterday' },
  { reason: '' },
  { leaveType: 'invented' },
  { staffId: 'forged' },
  { branchId: 'forged' },
  { guardianId: 'forged' },
])
  test('leave rejects invalid input ' + JSON.stringify(extra), async () => {
    assert.equal(
      (await http(root + '/leave', teacher, leave(extra))).status,
      400,
    );
    assert.equal(await StaffLeave.countDocuments(), 0);
  });
test('existing Principal approval flow changes status; private decision notes are omitted', async () => {
  const created = await http(root + '/leave', teacher, leave());
  const row = await StaffLeave.findById(created.data.leaveId);
  const id = String(row!.approvalRequestId);
  const detail = await http('/approval-requests/' + id, principal);
  assert.equal(detail.status, 200, detail.raw);
  assert.equal(detail.data.staffLeave.startDate, day());
  const reviewed = await http(
    '/approval-requests/' + id,
    principal,
    { action: 'approved', reason: 'Private HR-only reviewer text' },
    'PATCH',
  );
  assert.equal(reviewed.status, 200, reviewed.raw);
  const own = await http(root + '/leave');
  assert.equal(own.data.items[0].status, 'approved');
  assert.equal(own.data.balances[0].approvedDays, 2);
  assert.ok(!own.raw.includes('Private HR-only'));
});
test('foreign Principal cannot approve staff leave', async () => {
  await http(root + '/leave', teacher, leave());
  const row = await StaffLeave.findOne();
  const foreignPrincipal = await actor('principal', foreign);
  assert.notEqual(
    (
      await http(
        '/approval-requests/' + row!.approvalRequestId,
        foreignPrincipal,
        { action: 'approved' },
        'PATCH',
      )
    ).status,
    200,
  );
});
test('staff leave resubmission never discloses private reviewer notes', async () => {
  const created = await http(root + '/leave', teacher, leave());
  const row = await StaffLeave.findById(created.data.leaveId);
  const path = '/approval-requests/' + row!.approvalRequestId;
  const reviewed = await http(
    path,
    principal,
    { action: 'changes_requested', reason: 'Private HR-only change review' },
    'PATCH',
  );
  assert.equal(reviewed.status, 200, reviewed.raw);
  const own = await http(path + '/resubmission');
  assert.equal(own.status, 200, own.raw);
  assert.equal(own.data.status, 'changes_requested');
  assert.ok(!own.raw.includes('Private HR-only'));
  assert.equal(own.data.changeReason, undefined);
  assert.notEqual((await http(path + '/resubmission', other)).status, 200);
  const resubmitted = await fetch(base + path + '/resubmit', {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${teacher.token}`,
      'Content-Type': 'application/json',
      'If-Match': `"${own.data.revision}"`,
    },
    body: JSON.stringify({ reason: 'Updated request explanation' }),
  });
  const result = await resubmitted.json() as { data: { status: string } };
  assert.equal(resubmitted.status, 200, JSON.stringify(result));
  assert.ok(!JSON.stringify(result).includes('Private HR-only'));
  assert.equal(result.data.status, 'pending');
});
test('missing permission and revoked identity/session fail closed', async () => {
  ROLE_PERMISSIONS.teacher = grants.filter(
    p => p !== PERMISSIONS.STAFF_LEAVE_REQUEST,
  );
  assert.equal((await http(root + '/leave', teacher, leave())).status, 403);
  ROLE_PERMISSIONS.teacher = [...grants];
  await Session.updateMany(
    { userId: teacher.id },
    { $set: { isRevoked: true } },
  );
  assert.equal((await http(root + '/leave')).status, 401);
  await Session.updateMany(
    { userId: other.id },
    { $set: { isRevoked: false } },
  );
  await User.updateOne({ _id: other.id }, { $set: { isActive: false } });
  assert.equal((await http(root + '/summary', other)).status, 401);
});
for (const path of [
  '/summary',
  '/leave',
  '/payslips',
  '/documents',
  '/appointments',
])
  test('Student and Principal denied ' + path, async () => {
    assert.equal((await http(root + path, student)).status, 403);
    assert.equal((await http(root + path, principal)).status, 403);
  });
async function payslip(who = teacher, extra = {}) {
  return StaffPayslip.create({
    branchId: branch,
    teacherId: who.id,
    period: '2026-09',
    status: 'approved',
    approvedAt: new Date(),
    netAmount: 100,
    currency: 'PKR',
    ...extra,
  });
}
test('only own approved payslips; foreign, draft and guessed IDs denied', async () => {
  const own = await payslip(),
    draft = await payslip(teacher, { period: '2026-10', status: 'draft' }),
    otherSlip = await payslip(other);
  const list = await http(root + '/payslips');
  assert.equal(list.data.items.length, 1);
  assert.equal(list.data.items[0].payslipId, String(own._id));
  for (const id of [draft._id, otherSlip._id, oid()])
    assert.equal((await http(root + '/payslips/' + id)).status, 404);
  assert.equal(
    (await http(root + '/payslips/' + own._id, outsider)).status,
    404,
  );
  assert.equal(
    (await http(root + '/payslips?teacherId=' + other.id)).status,
    400,
  );
});
test('file delivery is authenticated, approved-only, private and unguessable by another owner', async () => {
  const bytes = Buffer.from('owned fixture content');
  const own = await payslip(teacher, {
    hasFile: true,
    mime: 'application/pdf',
    content: bytes,
  });
  const file = await http(root + '/payslips/' + own._id + '/file');
  assert.equal(file.status, 200);
  assert.equal(file.raw, bytes.toString());
  assert.equal(file.headers.get('cache-control'), 'no-store');
  assert.equal(
    (await http(root + '/payslips/' + own._id + '/file', other)).status,
    404,
  );
  const content = await http(root + '/payslips/' + own._id + '/file-content');
  assert.equal(content.data.base64, bytes.toString('base64'));
  await StaffPayslip.updateOne({ _id: own._id }, { $set: { status: 'draft' } });
  assert.equal(
    (await http(root + '/payslips/' + own._id + '/file-content')).status,
    404,
  );
});
test('documents owner visibility, hidden records and file privacy', async () => {
  const own = await StaffDocument.create({
    branchId: branch,
    teacherId: teacher.id,
    title: 'Supplied record',
    documentType: 'School-provided type',
    expiresOn: day(),
    visibleToOwner: true,
    hasFile: true,
    mime: 'image/png',
    content: Buffer.from('fixture'),
  });
  const hidden = await StaffDocument.create({
    branchId: branch,
    teacherId: teacher.id,
    title: 'Hidden record',
    documentType: 'Private',
    visibleToOwner: false,
  });
  assert.equal((await http(root + '/documents')).data.items.length, 1);
  assert.equal((await http(root + '/documents/' + own._id)).status, 200);
  assert.equal((await http(root + '/documents/' + own._id, other)).status, 404);
  assert.equal((await http(root + '/documents/' + hidden._id)).status, 404);
  assert.equal(
    (await http(root + '/documents/' + own._id + '/file', outsider)).status,
    404,
  );
  const list = await http(root + '/documents');
  for (const term of [
    'content',
    'base64',
    'branchId',
    'teacherId',
    'storage',
    '__v',
  ])
    assert.ok(!list.raw.includes('"' + term + '"'));
});
test('expiry deterministic at today and 30-day boundaries', () => {
  assert.equal(documentExpiryStatus('2026-10-18', '2026-10-19'), 'expired');
  assert.equal(
    documentExpiryStatus('2026-10-19', '2026-10-19'),
    'expiring_soon',
  );
  assert.equal(
    documentExpiryStatus('2026-11-18', '2026-10-19'),
    'expiring_soon',
  );
  assert.equal(documentExpiryStatus('2026-11-19', '2026-10-19'), 'valid');
  assert.equal(documentExpiryStatus(null, '2026-10-19'), 'no_expiry');
});
test('slot creation and retry retain one record', async () => {
  const a = await createSlot(),
    b = await createSlot();
  assert.equal(a.appointmentId, b.appointmentId);
  assert.equal(await StaffAppointment.countDocuments(), 1);
  assert.equal(a.status, 'available');
  assert.equal(
    (
      await http(
        root + '/appointments/slots',
        teacher,
        slot({ title: 'Changed intent' }),
      )
    ).status,
    409,
  );
});
test('overlap conflicts; adjacent slots are valid', async () => {
  await createSlot();
  for (const [index, [startTime, endTime]] of [
    ['10:00', '11:00'],
    ['09:30', '10:30'],
    ['10:30', '11:30'],
    ['09:00', '12:00'],
    ['10:15', '10:45'],
  ].entries()) {
    const result = await http(
      root + '/appointments/slots',
      teacher,
      slot({
        startTime,
        endTime,
        clientOperationId: `slot_overlap_operation_${index}`,
      }),
    );
    assert.equal(result.status, 409, `${startTime}-${endTime}: ${result.raw}`);
  }
  assert.equal(
    (
      await http(
        root + '/appointments/slots',
        teacher,
        slot({
          startTime: '11:00',
          endTime: '12:00',
          clientOperationId: 'slot_adjacent_operation_02',
        }),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await http(
        root + '/appointments/slots',
        teacher,
        slot({
          startTime: '09:00',
          endTime: '10:00',
          clientOperationId: 'slot_adjacent_before_operation',
        }),
      )
    ).status,
    200,
  );
});
test('two API instances cannot create overlapping slots', async () => {
  const result = await Promise.all([
    http(root + '/appointments/slots', teacher, slot()),
    http(
      root + '/appointments/slots',
      teacher,
      slot({
        startTime: '10:30',
        endTime: '11:30',
        clientOperationId: 'second_instance_slot_01',
      }),
      'POST',
      second,
    ),
  ]);
  assert.deepEqual(result.map(r => r.status).sort(), [200, 409]);
  assert.equal(await StaffAppointment.countDocuments(), 1);
});
test('two API instances retry the same slot exactly once', async () => {
  const result = await Promise.all([
    http(root + '/appointments/slots', teacher, slot()),
    http(root + '/appointments/slots', teacher, slot(), 'POST', second),
  ]);
  assert.deepEqual(
    result.map(r => r.status),
    [200, 200],
  );
  assert.equal(result[0].data.appointmentId, result[1].data.appointmentId);
});
test('reschedule rejects conflicts and stale revision, preserving original history', async () => {
  const a = await createSlot(),
    b = await createSlot({
      startTime: '12:00',
      endTime: '13:00',
      clientOperationId: 'second_slot_operation_01',
    });
  assert.equal(
    (
      await http(
        `${root}/appointments/${a.appointmentId}/reschedule`,
        teacher,
        change({ date: day(), startTime: '12:30', endTime: '13:30' }),
      )
    ).status,
    409,
  );
  const body = change({ date: day(), startTime: '14:00', endTime: '15:00' });
  const moved = await http(
    `${root}/appointments/${a.appointmentId}/reschedule`,
    teacher,
    body,
  );
  assert.equal(moved.status, 200, moved.raw);
  assert.equal(moved.data.history[0].startTime, '10:00');
  assert.equal(moved.data.history[1].startTime, '14:00');
  assert.equal(
    (
      await http(
        `${root}/appointments/${a.appointmentId}/reschedule`,
        teacher,
        body,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await http(
        `${root}/appointments/${a.appointmentId}/cancel`,
        teacher,
        change({ clientOperationId: 'stale_cancel_operation_01' }),
      )
    ).status,
    409,
  );
  assert.equal(
    (await http(`${root}/appointments/${b.appointmentId}`)).data.items[0]
      .startTime,
    '12:00',
  );
});
test('two simultaneous reschedules into one free interval serialize', async () => {
  const a = await createSlot(),
    b = await createSlot({
      startTime: '12:00',
      endTime: '13:00',
      clientOperationId: 'second_slot_operation_01',
    });
  const result = await Promise.all([
    http(
      `${root}/appointments/${a.appointmentId}/reschedule`,
      teacher,
      change({ date: day(), startTime: '14:00', endTime: '15:00' }),
    ),
    http(
      `${root}/appointments/${b.appointmentId}/reschedule`,
      teacher,
      change({
        date: day(),
        startTime: '14:30',
        endTime: '15:30',
        clientOperationId: 'second_reschedule_operation_01',
      }),
      'POST',
      second,
    ),
  ]);
  assert.deepEqual(result.map(r => r.status).sort(), [200, 409]);
});
test('other Teacher, foreign branch and guessed appointment are denied', async () => {
  const a = await createSlot();
  for (const who of [other, outsider]) {
    assert.equal(
      (await http(`${root}/appointments/${a.appointmentId}`, who)).status,
      404,
    );
    assert.equal(
      (
        await http(
          `${root}/appointments/${a.appointmentId}/cancel`,
          who,
          change(),
        )
      ).status,
      404,
    );
  }
  assert.equal((await http(`${root}/appointments/${oid()}`)).status, 404);
});
async function academicStudent() {
  const cls = await new SchoolClass({
    name: 'Grade 8',
    code: 'G8',
    branchId: branch,
    academicYear: '2026',
    academicPeriodId: oid(),
  }).save();
  const sec = await new Section({
    name: 'A',
    code: 'A',
    branchId: branch,
    classId: cls._id,
  }).save();
  const sub = await Subject.create({ name: 'Mathematics', branchId: branch });
  await new TeacherAssignment({
    branchId: branch,
    teacherId: teacher.id,
    classId: cls._id,
    sectionId: sec._id,
    subjectId: sub._id,
    createdBy: principal.id,
    updatedBy: principal.id,
    validFrom: new Date('2026-01-01'),
  }).save();
  const pupil = await new Student({
    userId: student.id,
    branchId: branch,
    classId: cls._id,
    sectionId: sec._id,
    admissionNumber: 'STAFF-001',
  }).save();
  return {
    studentId: String(pupil._id),
    classId: String(cls._id),
    sectionId: String(sec._id),
    subjectId: String(sub._id),
    periodId: String(cls.academicPeriodId),
  };
}
test('PTM uses assigned roster; unrelated/foreign Student and guardian claims denied', async () => {
  const context = await academicStudent(),
    a = await createSlot();
  const target = {
    studentId: context.studentId,
    classId: context.classId,
    sectionId: context.sectionId,
    subjectId: context.subjectId,
  };
  const candidates = await http(root + '/appointment-students');
  assert.equal(candidates.data.items.length, 1);
  assert.equal(candidates.data.parentBookingSupported, false);
  const foreignPupil = await new Student({
    userId: student.id,
    branchId: foreign,
    classId: context.classId,
    sectionId: context.sectionId,
    admissionNumber: 'FOREIGN',
  }).save();
  assert.equal(
    (
      await http(
        `${root}/appointments/${a.appointmentId}/confirm`,
        teacher,
        change({ ...target, studentId: String(foreignPupil._id) }),
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await http(
        `${root}/appointments/${a.appointmentId}/confirm`,
        teacher,
        change({ ...target, parentId: oid() }),
      )
    ).status,
    400,
  );
  const result = await http(
    `${root}/appointments/${a.appointmentId}/confirm`,
    teacher,
    change(target),
  );
  assert.equal(result.status, 200, result.raw);
  assert.equal(result.data.studentName, 'student Person');
  await TeacherAssignment.updateMany({}, { $set: { isActive: false } });
  assert.equal(
    (await http(`${root}/appointments/${a.appointmentId}`)).status,
    404,
  );
  assert.equal((await http(root + '/appointments')).data.items.length, 0);
});
test('managed withdrawn Student cannot fall back to compatibility fields for PTM', async () => {
  const ctx = await academicStudent();
  const { periodId, ...target } = ctx;
  const a = await createSlot();
  await StudentEnrollment.create({
    studentId: ctx.studentId,
    branchId: branch,
    academicPeriodId: periodId,
    classId: ctx.classId,
    sectionId: ctx.sectionId,
    status: 'withdrawn',
    effectiveFrom: new Date('2026-01-01'),
    effectiveTo: new Date('2026-02-01'),
    reason: 'Fixture withdrawal',
    createdBy: principal.id,
    updatedBy: principal.id,
  });
  assert.equal(
    (
      await http(
        `${root}/appointments/${a.appointmentId}/confirm`,
        teacher,
        change(target),
      )
    ).status,
    404,
  );
});
test('cancelled slot frees interval and replay cannot change a terminal state', async () => {
  const a = await createSlot();
  const cancelled = await http(
    `${root}/appointments/${a.appointmentId}/cancel`,
    teacher,
    change(),
  );
  assert.equal(cancelled.status, 200);
  assert.equal(
    (
      await http(
        `${root}/appointments/${a.appointmentId}/confirm`,
        teacher,
        change({
          revision: 2,
          clientOperationId: 'confirm_cancelled_operation_01',
        }),
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await http(
        root + '/appointments/slots',
        teacher,
        slot({ clientOperationId: 'replacement_slot_operation_01' }),
      )
    ).status,
    200,
  );
});
test('appointment DTO has no locks, receipts, guardian details or private identity', async () => {
  await createSlot();
  const result = await http(root + '/appointments');
  for (const term of [
    'teacherId',
    'branchId',
    '__v',
    'clientOperationId',
    'fingerprint',
    'guardianPhone',
    'password',
  ])
    assert.ok(!result.raw.includes('"' + term + '"'));
});
test('role/branch change invalidates own data rather than retaining former Branch access', async () => {
  await createSlot();
  await User.updateOne({ _id: teacher.id }, { $set: { branchId: foreign } });
  assert.equal((await http(root + '/appointments')).data.items.length, 0);
  await User.updateOne({ _id: teacher.id }, { $set: { role: 'student' } });
  assert.equal((await http(root + '/summary')).status, 401);
});
