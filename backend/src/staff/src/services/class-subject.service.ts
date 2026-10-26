import type { ClientSession } from 'mongoose';
import { ClassSubject } from '../models/classSubject';
import { AcademicPeriod } from '../models/academicPeriod';
import SchoolClass from '../models/schoolClass';
import Subject from '../models/subject';
import User from '../models/user';
import Session from '../models/session';
import TeacherAssignment from '../models/teacherAssignment';
import { Syllabus } from '../models/syllabus';
import { TimetablePeriod, TimetableVersion } from '../models/timetable';
import { academicSetupScope } from './academic-setup.service';
import { withAcademicCatalogLock } from './academic-catalog-lock.service';
import { schoolToday } from './school-date.service';
import {
  objectBody,
  objectIdField,
  RequestContractError,
} from '../utils/request-validation';
import type { JwtPayload } from './jwt.service';

const missing = () =>
  new RequestContractError(404, 'Class Subject is unavailable');
const conflict = (message: string) => new RequestContractError(409, message);
async function context(
  branchId: string,
  id: unknown,
  session?: ClientSession,
  writable = false,
) {
  const schoolClass = await SchoolClass.findOne()
    .where('_id')
    .equals(objectIdField(id, 'class ID'))
    .where('branchId')
    .equals(branchId)
    .session(session ?? null)
    .lean();
  if (!schoolClass) throw missing();
  const period = schoolClass.academicPeriodId
    ? await AcademicPeriod.findOne({
        _id: schoolClass.academicPeriodId,
        branchId,
      })
        .session(session ?? null)
        .lean()
    : null;
  if (schoolClass.academicPeriodId && !period) throw missing();
  if (writable && (!schoolClass.isActive || period?.status !== 'active'))
    throw conflict(
      'An active Class in the current Academic Period is required. Legacy Classes need an explicit migration.',
    );
  return { schoolClass, period };
}
const classDTO = (row: any) => ({
  id: String(row._id),
  name: row.name,
  code: row.code,
  isActive: row.isActive,
});
const periodDTO = (row: any) =>
  row
    ? {
        id: String(row._id),
        name: row.name,
        code: row.code,
        status: row.status,
      }
    : null;
const mappingDTO = (row: any, subject: any) => ({
  id: String(row._id),
  subject: {
    id: String(row.subjectId),
    name: subject?.name ?? 'Unavailable Subject',
    isActive: subject?.isActive ?? false,
  },
  isActive: row.isActive,
  revision: row.revision,
});
const pageOffset = (input: unknown) => {
  const value = input === undefined ? 0 : Number(input);
  if (!Number.isSafeInteger(value) || value < 0 || value > 100000)
    throw new RequestContractError(400, 'Invalid page offset');
  return value;
};
export async function readClassSubjects(
  identity: JwtPayload | undefined,
  classId: unknown,
  query: unknown,
  options = false,
) {
  const input = objectBody(query, ['branchId', 'offset']);
  const { branchId } = await academicSetupScope(
    identity,
    'classSubjects',
    options,
    input.branchId,
  );
  const { schoolClass, period } = await context(
    branchId,
    classId,
    undefined,
    options,
  );
  const filter = {
    branchId,
    classId: schoolClass._id,
    academicPeriodId: period?._id ?? null,
  };
  const offset = pageOffset(input.offset);
  if (options) {
    // Inactive entries retain identity; reactivate them from the main list.
    const mapped = await ClassSubject.find(filter).select('subjectId').lean();
    const available = {
      branchId,
      isActive: true,
      _id: { $nin: mapped.map(row => row.subjectId) },
    };
    const rows = await Subject.find(available)
      .sort({ name: 1, _id: 1 })
      .skip(offset)
      .limit(50)
      .select('_id name')
      .lean();
    const total = await Subject.countDocuments(available);
    return {
      items: rows.map(row => ({ id: String(row._id), name: row.name })),
      total,
      nextOffset: offset + rows.length < total ? offset + rows.length : null,
    };
  }
  const rows = await ClassSubject.find(filter)
    .sort({ _id: 1 })
    .skip(offset)
    .limit(50)
    .lean();
  const subjects = await Subject.find({
    branchId,
    _id: { $in: rows.map(row => row.subjectId) },
  })
    .select('_id name isActive')
    .lean();
  const total = await ClassSubject.countDocuments(filter);
  return {
    class: classDTO(schoolClass),
    period: periodDTO(period),
    writable: schoolClass.isActive && period?.status === 'active',
    items: rows.map(row =>
      mappingDTO(
        row,
        subjects.find(subject => String(subject._id) === String(row.subjectId)),
      ),
    ),
    total,
    nextOffset: offset + rows.length < total ? offset + rows.length : null,
  };
}
async function assertNoDependencies(row: any, session: ClientSession) {
  const tuple = {
    branchId: row.branchId,
    classId: row.classId,
    subjectId: row.subjectId,
  };
  // isActive reserves authority even for upcoming/expired assignments.
  if (
    await TeacherAssignment.exists({ ...tuple, isActive: true }).session(
      session,
    )
  )
    throw conflict(
      'Revoke active Teacher Assignments before deactivating this Class Subject',
    );
  if (await Syllabus.exists({ ...tuple, status: 'published' }).session(session))
    throw conflict(
      'Retire the published Syllabus before deactivating this Class Subject',
    );
  const versions = await TimetableVersion.find({
    branchId: row.branchId,
    status: 'approved',
    effectiveUntil: { $gt: schoolToday() },
  })
    .select('_id')
    .session(session)
    .lean();
  if (
    await TimetablePeriod.exists({
      ...tuple,
      timetableVersionId: { $in: versions.map(version => version._id) },
    }).session(session)
  )
    throw conflict(
      'Retire current or future approved Timetables before deactivating this Class Subject',
    );
}
export async function writeClassSubject(
  identity: JwtPayload | undefined,
  token: string,
  classId: unknown,
  query: unknown,
  action: 'create' | 'deactivate' | 'reactivate',
  id: unknown,
  body: unknown,
) {
  const input = objectBody(
    body,
    action === 'create' ? ['subjectId'] : ['revision'],
  );
  const request = objectBody(query, ['branchId']);
  const initial = await academicSetupScope(
    identity,
    'classSubjects',
    true,
    request.branchId,
  );
  try {
    return await withAcademicCatalogLock(initial.branchId, async session => {
      await User.collection.updateOne(
        { _id: initial.actor._id },
        { $inc: { __v: 1 } },
        { session },
      );
      const login = await Session.collection.updateMany(
        {
          token,
          userId: initial.actor._id,
          role: initial.actor.role,
          isRevoked: false,
        },
        { $inc: { __v: 1 } },
        { session },
      );
      if (!login.matchedCount)
        throw new RequestContractError(401, 'Session is unavailable');
      const ctx = await academicSetupScope(
        identity,
        'classSubjects',
        true,
        request.branchId,
        session,
      );
      if (ctx.branchId !== initial.branchId) throw missing();
      const { schoolClass, period } = await context(
        ctx.branchId,
        classId,
        session,
        true,
      );
      let row =
        action === 'create'
          ? null
          : await ClassSubject.findOne({
              _id: objectIdField(id, 'Class Subject ID'),
              branchId: ctx.branchId,
              academicPeriodId: period!._id,
              classId: schoolClass._id,
            }).session(session);
      if (action !== 'create' && !row) throw missing();
      if (
        row &&
        (!Number.isSafeInteger(input.revision) ||
          (input.revision as number) < 1)
      )
        throw new RequestContractError(400, 'A positive revision is required');
      if (row && row.revision !== input.revision)
        throw conflict('Class Subject changed; refresh before saving');
      const subjectId = row
        ? String(row.subjectId)
        : objectIdField(input.subjectId, 'subject ID');
      const subject = await Subject.findOne({
        _id: subjectId,
        branchId: ctx.branchId,
        ...(action === 'deactivate' ? {} : { isActive: true }),
      })
        .session(session)
        .lean();
      if (!subject) throw missing();
      if (action === 'create') {
        [row] = await ClassSubject.create(
          [
            {
              branchId: ctx.branchId,
              academicPeriodId: period!._id,
              classId: schoolClass._id,
              subjectId,
              createdBy: ctx.actor._id,
              updatedBy: ctx.actor._id,
            },
          ],
          { session },
        );
      } else {
        if (row!.isActive === (action === 'reactivate'))
          throw conflict('Class Subject is already in that state');
        if (action === 'deactivate') await assertNoDependencies(row, session);
        row!.isActive = action === 'reactivate';
        row!.revision += 1;
        row!.updatedBy = ctx.actor._id;
        await row!.save({ session });
      }
      return {
        class: classDTO(schoolClass),
        period: periodDTO(period),
        ...mappingDTO(row, subject),
      };
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000)
      throw conflict(
        'This Subject is already added to the Class; reactivate an inactive entry instead',
      );
    throw error;
  }
}
