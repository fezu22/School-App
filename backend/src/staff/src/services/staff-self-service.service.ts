import {type SessionAuthority} from './authenticated-session.service';
import { createHash } from 'node:crypto';
import { Types, type ClientSession } from 'mongoose';
import ApprovalRequest from '../models/approvalRequest';
import Student from '../models/student';
import User from '../models/user';
import {
  StaffLeave,
  StaffPayslip,
  StaffDocument,
  StaffAppointment,
  StaffSelfServiceReceipt,
} from '../models/staffSelfService';
import { PERMISSIONS, type Permission } from '../constants/permissions';
import {
  communicationScope,
  withTeacherCommunication,
  communicationFence,
  type Identity,
} from './teacher-communication-access.service';
import { getTeacherRoster } from './teacher-roster.service';
import {
  schoolToday,
  schoolDateTime,
  schoolTimezone,
  addScheduleDays,
  scheduleDate,
} from './school-date.service';
import {
  objectBody,
  objectIdField,
  textField,
  enumField,
  RequestContractError,
} from '../utils/request-validation';

const missing = () =>
  new RequestContractError(404, 'Record is unavailable or outside your scope');
const conflict = (message: string) => new RequestContractError(409, message);
type Scope = Awaited<ReturnType<typeof communicationScope>>;
const owner = (s: Scope) => ({ branchId: s.branchId, teacherId: s.actorId });
export const staffScope = (identity: Identity, permission: Permission) =>
  communicationScope(identity, permission);
const operation = (value: unknown) => {
  const id = textField(value, 'operation ID', 100, 12);
  if (!/^[a-zA-Z0-9_-]+$/.test(id))
    throw new RequestContractError(400, 'Invalid operation ID');
  return id;
};
const revision = (value: unknown) => {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new RequestContractError(400, 'Invalid revision');
  return Number(value);
};
async function receipt(
  scope: Scope,
  session: ClientSession,
  op: string,
  fingerprint: string,
) {
  const found = await StaffSelfServiceReceipt.findOne({
    teacherId: scope.actorId,
    clientOperationId: op,
  }).session(session);
  if (
    found &&
    (String(found.branchId) !== scope.branchId ||
      found.fingerprint !== fingerprint)
  )
    throw conflict('Operation ID was already used for a different request');
  return found;
}
async function saveReceipt(
  scope: Scope,
  session: ClientSession,
  op: string,
  fingerprint: string,
  resultId: unknown,
) {
  await StaffSelfServiceReceipt.create(
    [
      {
        ...owner(scope),
        clientOperationId: op,
        fingerprint,
        resultId: String(resultId),
      },
    ],
    { session },
  );
}
const fingerprint = (action: string, body: unknown) =>
  createHash('sha256').update(JSON.stringify({ action, body })).digest('hex');

const leaveDTO = (
  row: NonNullable<Awaited<ReturnType<typeof StaffLeave.findOne>>>,
  approval: NonNullable<Awaited<ReturnType<typeof ApprovalRequest.findOne>>>,
) => ({
  leaveId: String(row._id),
  leaveType: row.leaveType,
  startDate: row.startDate,
  endDate: row.endDate,
  days: row.days,
  reason: row.reason,
  status: approval.status,
  createdAt: row.createdAt,
  // Reviewer reasons may contain HR-only notes; actions/timestamps are sufficient.
  history: [
    { action: 'requested', createdAt: row.createdAt },
    ...approval.history.map(h => ({
      action: h.action,
      createdAt: h.createdAt,
    })),
  ],
});
export async function listStaffLeave(identity: Identity) {
  const scope = await staffScope(identity, PERMISSIONS.STAFF_SELF_SERVICE_VIEW);
  const rows = await StaffLeave.find(owner(scope))
    .read('primary')
    .sort({ createdAt: -1 });
  const items: ReturnType<typeof leaveDTO>[] = [];
  for (const row of rows) {
    const approval = await ApprovalRequest.findOne({
      _id: row.approvalRequestId,
      branchId: scope.branchId,
      requesterId: scope.actorId,
      entityType: 'staff_leave',
      entityId: row._id,
      approvalType: 'leave',
    }).read('primary');
    if (approval) items.push(leaveDTO(row, approval));
  }
  return {
    items,
    balances: (['personal', 'sick', 'unpaid'] as const).map(leaveType => ({
      leaveType,
      available: null,
      approvedDays: items
        .filter(i => i.leaveType === leaveType && i.status === 'approved')
        .reduce((n, i) => n + i.days, 0),
      pendingDays: items
        .filter(
          i =>
            i.leaveType === leaveType &&
            ['pending', 'changes_requested'].includes(i.status),
        )
        .reduce((n, i) => n + i.days, 0),
    })),
    balancePolicy:
      'No allowance ledger configured; totals are requested calendar days, not payroll deductions.',
    cancellationSupported: false,
  };
}
export async function requestStaffLeave(
  identity: Identity,
  token: SessionAuthority,
  raw: unknown,
) {
  const body = objectBody(raw, [
    'leaveType',
    'startDate',
    'endDate',
    'reason',
    'clientOperationId',
  ]);
  const leaveType = enumField(body.leaveType, 'leave type', [
    'personal',
    'sick',
    'unpaid',
  ] as const);
  const startDate = scheduleDate(body.startDate),
    endDate = scheduleDate(body.endDate);
  const reason = textField(body.reason, 'reason', 350, 3),
    op = operation(body.clientOperationId);
  const days = (Date.parse(endDate) - Date.parse(startDate)) / 86400000 + 1;
  if (endDate < startDate || days > 366)
    throw new RequestContractError(
      400,
      'Enter a valid date range of at most 366 calendar days',
    );
  const fp = fingerprint('leave', { leaveType, startDate, endDate, reason });
  return withTeacherCommunication(
    identity,
    token,
    PERMISSIONS.STAFF_LEAVE_REQUEST,
    undefined,
    async (session, scope) => {
      const previous = await receipt(scope, session, op, fp);
      if (previous) {
        const row = await StaffLeave.findOne({
          ...owner(scope),
          _id: previous.resultId,
        }).session(session);
        const approval =
          row &&
          (await ApprovalRequest.findById(row.approvalRequestId).session(
            session,
          ));
        if (!row || !approval) throw missing();
        return leaveDTO(row, approval);
      }
      if (startDate < schoolToday())
        throw new RequestContractError(400, 'Leave must start today or later');
      const overlaps = await StaffLeave.find({
        ...owner(scope),
        startDate: { $lte: endDate },
        endDate: { $gte: startDate },
      }).session(session);
      if (
        await ApprovalRequest.exists({
          _id: { $in: overlaps.map(l => l.approvalRequestId) },
          status: { $in: ['pending', 'approved', 'changes_requested'] },
        }).session(session)
      )
        throw conflict('A leave request already covers these dates');
      const leaveId = new Types.ObjectId();
      const [approval] = await ApprovalRequest.create(
        [
          {
            branchId: scope.branchId,
            requesterId: scope.actorId,
            entityType: 'staff_leave',
            entityId: leaveId,
            approvalType: 'leave',
            reason: `${leaveType} leave, ${startDate} to ${endDate}: ${reason}`,
            status: 'pending',
            history: [],
          },
        ],
        { session },
      );
      const [row] = await StaffLeave.create(
        [
          {
            _id: leaveId,
            ...owner(scope),
            leaveType,
            startDate,
            endDate,
            days,
            reason,
            approvalRequestId: approval!._id,
          },
        ],
        { session },
      );
      await saveReceipt(scope, session, op, fp, row!._id);
      return leaveDTO(row!, approval!);
    },
  );
}

export const documentExpiryStatus = (
  expiresOn: string | null | undefined,
  today = schoolToday(),
) =>
  !expiresOn
    ? 'no_expiry'
    : expiresOn < today
    ? 'expired'
    : expiresOn <= addScheduleDays(today, 30)
    ? 'expiring_soon'
    : 'valid';
export async function listStaffPayslips(identity: Identity, id?: unknown) {
  const scope = await staffScope(identity, PERMISSIONS.STAFF_PAYSLIP_VIEW_OWN);
  const rows = await StaffPayslip.find({
    ...owner(scope),
    status: 'approved',
    approvedAt: { $ne: null },
    ...(id === undefined ? {} : { _id: objectIdField(id, 'payslip ID') }),
  })
    .read('primary')
    .sort({ period: -1 });
  if (id !== undefined && !rows.length) throw missing();
  return {
    items: rows.map(r => ({
      payslipId: String(r._id),
      period: r.period,
      status: 'approved' as const,
      approvedAt: r.approvedAt,
      netAmount: r.netAmount ?? null,
      currency: r.currency ?? null,
      canDownload: !!r.hasFile,
    })),
  };
}
export async function listStaffDocuments(identity: Identity, id?: unknown) {
  const scope = await staffScope(
    identity,
    PERMISSIONS.STAFF_DOCUMENTS_VIEW_OWN,
  );
  const rows = await StaffDocument.find({
    ...owner(scope),
    visibleToOwner: true,
    ...(id === undefined ? {} : { _id: objectIdField(id, 'document ID') }),
  })
    .read('primary')
    .sort({ expiresOn: 1, title: 1 });
  if (id !== undefined && !rows.length) throw missing();
  return {
    items: rows.map(r => ({
      documentId: String(r._id),
      title: r.title,
      documentType: r.documentType,
      expiresOn: r.expiresOn ?? null,
      status: documentExpiryStatus(r.expiresOn),
      canDownload: !!r.hasFile,
    })),
  };
}
export async function staffFile(
  identity: Identity,
  kind: 'payslips' | 'documents',
  id: unknown,
) {
  const scope = await staffScope(
    identity,
    kind === 'payslips'
      ? PERMISSIONS.STAFF_PAYSLIP_VIEW_OWN
      : PERMISSIONS.STAFF_DOCUMENTS_VIEW_OWN,
  );
  const filter = {
    ...owner(scope),
    _id: objectIdField(id, 'file ID'),
    hasFile: true,
  };
  const row =
    kind === 'payslips'
      ? await StaffPayslip.findOne({
          ...filter,
          status: 'approved',
          approvedAt: { $ne: null },
        })
          .select('+content')
          .read('primary')
      : await StaffDocument.findOne({ ...filter, visibleToOwner: true })
          .select('+content')
          .read('primary');
  if (!row?.content?.length || !row.mime || row.content.length > 10_000_000)
    throw missing();
  return { content: row.content, mime: row.mime };
}

// Student labels and authority are resolved through the existing assignment /
// enrollment roster, including managed-enrollment withdrawal and transfer rules.
async function studentContext(
  identity: Identity,
  scope: Scope,
  row: {
    studentId?: unknown;
    classId?: unknown;
    sectionId?: unknown;
    subjectId?: unknown;
  },
) {
  if (!row.studentId) return undefined;
  const tuple = scope.tuples.find(
    t =>
      t.classId === String(row.classId) &&
      t.sectionId === String(row.sectionId) &&
      t.subjectId === String(row.subjectId),
  );
  if (!tuple) throw missing();
  const roster = await getTeacherRoster(identity, tuple);
  const student = roster.students.find(
    s => s.studentId === String(row.studentId),
  );
  if (!student) throw missing();
  return { tuple, student };
}
export async function appointmentStudents(identity: Identity) {
  const scope = await staffScope(
    identity,
    PERMISSIONS.STAFF_APPOINTMENTS_MANAGE_OWN,
  );
  const items = [];
  for (const tuple of scope.tuples) {
    const roster = await getTeacherRoster(identity, tuple);
    for (const student of roster.students)
      items.push({
        ...student,
        classId: tuple.classId,
        sectionId: tuple.sectionId,
        subjectId: tuple.subjectId,
        context: `${tuple.className} / ${tuple.sectionName} / ${tuple.subjectName}`,
      });
  }
  return { items, parentBookingSupported: false };
}
type Appointment = NonNullable<
  Awaited<ReturnType<typeof StaffAppointment.findOne>>
>;
async function appointmentDTO(
  identity: Identity,
  scope: Scope,
  row: Appointment,
) {
  const context = await studentContext(identity, scope, row);
  return {
    appointmentId: String(row._id),
    title: row.title,
    date: row.date,
    startTime: row.startTime,
    endTime: row.endTime,
    status: row.status,
    revision: row.revision,
    studentName: context?.student.fullName ?? null,
    context: context
      ? `${context.tuple.className} / ${context.tuple.sectionName} / ${context.tuple.subjectName}`
      : null,
    history: row.history.map(h => ({
      action: h.action,
      date: h.date,
      startTime: h.startTime,
      endTime: h.endTime,
      createdAt: h.createdAt,
    })),
  };
}
export async function listStaffAppointments(identity: Identity, id?: unknown) {
  const scope = await staffScope(identity, PERMISSIONS.STAFF_APPOINTMENTS_VIEW);
  const rows = await StaffAppointment.find({
    ...owner(scope),
    ...(id === undefined ? {} : { _id: objectIdField(id, 'appointment ID') }),
  })
    .read('primary')
    .sort({ date: 1, startTime: 1 });
  const items = [];
  for (const row of rows) {
    try {
      items.push(await appointmentDTO(identity, scope, row));
    } catch (e) {
      if (
        !(
          e instanceof RequestContractError &&
          e.status === 404 &&
          id === undefined
        )
      )
        throw e;
    }
  }
  if (id !== undefined && !items.length) throw missing();
  return {
    items,
    timezone: schoolTimezone(),
    today: schoolToday(),
    time: schoolDateTime().time,
    parentBookingSupported: false,
  };
}
function timeRange(body: Record<string, unknown>) {
  const date = scheduleDate(body.date);
  const time = (v: unknown) => {
    if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v))
      throw new RequestContractError(400, 'Use HH:mm for meeting times');
    return v;
  };
  const startTime = time(body.startTime),
    endTime = time(body.endTime);
  if (startTime >= endTime)
    throw new RequestContractError(400, 'Meeting end must be after its start');
  return { date, startTime, endTime };
}
function future(range: { date: string; startTime: string }) {
  const now = schoolDateTime();
  if (
    range.date < now.date ||
    (range.date === now.date && range.startTime <= now.time)
  )
    throw conflict('Choose a future meeting time');
}
async function noOverlap(
  scope: Scope,
  session: ClientSession,
  range: ReturnType<typeof timeRange>,
  except?: unknown,
) {
  if (
    await StaffAppointment.exists({
      ...owner(scope),
      ...(except ? { _id: { $ne: except } } : {}),
      status: { $in: ['available', 'confirmed'] },
      date: range.date,
      startTime: { $lt: range.endTime },
      endTime: { $gt: range.startTime },
    }).session(session)
  )
    throw conflict('This time overlaps another offered slot or meeting');
}
export async function offerStaffSlot(
  identity: Identity,
  token: SessionAuthority,
  raw: unknown,
) {
  const body = objectBody(raw, [
    'title',
    'date',
    'startTime',
    'endTime',
    'clientOperationId',
  ]);
  const range = timeRange(body),
    title = textField(body.title, 'meeting title', 120, 3),
    op = operation(body.clientOperationId);
  const fp = fingerprint('offer', { title, ...range });
  return withTeacherCommunication(
    identity,
    token,
    PERMISSIONS.STAFF_APPOINTMENTS_MANAGE_OWN,
    undefined,
    async (session, scope) => {
      const prev = await receipt(scope, session, op, fp);
      if (prev) {
        const row = await StaffAppointment.findOne({
          ...owner(scope),
          _id: prev.resultId,
        }).session(session);
        if (!row) throw missing();
        return appointmentDTO(identity, scope, row);
      }
      future(range);
      await noOverlap(scope, session, range);
      const [row] = await StaffAppointment.create(
        [
          {
            ...owner(scope),
            title,
            ...range,
            status: 'available',
            revision: 1,
            history: [{ action: 'offered', ...range, createdAt: new Date() }],
          },
        ],
        { session },
      );
      await saveReceipt(scope, session, op, fp, row!._id);
      return appointmentDTO(identity, scope, row!);
    },
  );
}
export async function changeStaffAppointment(
  identity: Identity,
  token: SessionAuthority,
  id: unknown,
  action: 'confirm' | 'reschedule' | 'cancel' | 'complete',
  raw: unknown,
) {
  const allowed =
    action === 'confirm'
      ? ['studentId', 'classId', 'sectionId', 'subjectId']
      : action === 'reschedule'
      ? ['date', 'startTime', 'endTime']
      : [];
  const body = objectBody(raw, [...allowed, 'revision', 'clientOperationId']);
  const expected = revision(body.revision),
    op = operation(body.clientOperationId),
    appointmentId = objectIdField(id, 'appointment ID');
  const initial = await staffScope(
    identity,
    PERMISSIONS.STAFF_APPOINTMENTS_MANAGE_OWN,
  );
  const initialRow = await StaffAppointment.findOne({
    ...owner(initial),
    _id: appointmentId,
  }).read('primary');
  if (!initialRow) throw missing();
  const requested =
    action === 'confirm' && body.studentId
      ? {
          studentId: objectIdField(body.studentId, 'student ID'),
          classId: objectIdField(body.classId, 'class ID'),
          sectionId: objectIdField(body.sectionId, 'section ID'),
          subjectId: objectIdField(body.subjectId, 'subject ID'),
        }
      : undefined;
  if (
    action === 'confirm' &&
    !requested &&
    allowed.some(k => body[k] !== undefined)
  )
    throw new RequestContractError(
      400,
      'Student and assigned context are required together',
    );
  const context = await studentContext(
    identity,
    initial,
    requested ?? initialRow,
  );
  const range = action === 'reschedule' ? timeRange(body) : undefined;
  const fp = fingerprint(action, { appointmentId, expected, requested, range });
  return withTeacherCommunication(
    identity,
    token,
    PERMISSIONS.STAFF_APPOINTMENTS_MANAGE_OWN,
    context?.tuple,
    async (session, scope) => {
      const row = await StaffAppointment.findOne({
        ...owner(scope),
        _id: appointmentId,
      }).session(session);
      if (!row) throw missing();
      if (context) {
        await communicationFence(
          session,
          Student.collection.name,
          context.student.studentId,
        );
        const pupil = await Student.findById(context.student.studentId)
          .session(session)
          .select('userId');
        if (!pupil) throw missing();
        await communicationFence(
          session,
          User.collection.name,
          String(pupil.userId),
        );
      }
      await studentContext(identity, scope, requested ?? row);
      const prev = await receipt(scope, session, op, fp);
      if (prev) return appointmentDTO(identity, scope, row);
      if (row.revision !== expected)
        throw conflict('Meeting changed. Reload before trying again');
      if (!['available', 'confirmed'].includes(row.status))
        throw conflict('This meeting is no longer editable');
      if (action === 'confirm') {
        if (row.status !== 'available')
          throw conflict('Only an available slot can be confirmed');
        future(row);
        if (requested) Object.assign(row, requested);
        row.status = 'confirmed';
      } else if (action === 'reschedule') {
        future(row);
        future(range!);
        await noOverlap(scope, session, range!, row._id);
        Object.assign(row, range);
      } else if (action === 'cancel') {
        future(row);
        row.status = 'cancelled';
      } else {
        const now = schoolDateTime();
        if (
          row.status !== 'confirmed' ||
          row.date > now.date ||
          (row.date === now.date && row.endTime > now.time)
        )
          throw conflict('Only a finished confirmed meeting can be completed');
        row.status = 'completed';
      }
      row.revision++;
      row.history.push({
        action:
          action === 'confirm'
            ? 'confirmed'
            : action === 'reschedule'
            ? 'rescheduled'
            : row.status,
        date: row.date,
        startTime: row.startTime,
        endTime: row.endTime,
        createdAt: new Date(),
      });
      await row.save({ session });
      await saveReceipt(scope, session, op, fp, row._id);
      return appointmentDTO(identity, scope, row);
    },
  );
}
