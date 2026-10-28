import {type SessionAuthority, revalidateAuthenticatedSession, authenticatedTransaction} from './authenticated-session.service';
import mongoose, { Types, type ClientSession } from 'mongoose';
import { Syllabus } from '../models/syllabus';
import SchoolClass from '../models/schoolClass';
import Subject from '../models/subject';
import User from '../models/user';

import Branch from '../models/branch';
import {requireClassSubject} from './class-subject-context.service';
import {requireAcademicBranch} from './school-authority.service';
import { PERMISSIONS } from '../constants/permissions';
import { ROLE_PERMISSIONS } from '../constants/rolePermissions';
import {
  currentAcademicActor,
  requireActiveAcademicBranch,
  getTeacherScope,
} from './teacher-scope.service';
import {
  communicationFence,
  exactTuple,
} from './teacher-communication-access.service';
import type { JwtPayload } from './jwt.service';
import {
  objectBody,
  objectIdField,
  textField,
  RequestContractError,
} from '../utils/request-validation';

export const academicMissing = () =>
  new RequestContractError(404, 'Academic context is unavailable');
export const revisionField = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new RequestContractError(400, 'A positive revision is required');
  return value;
};
const structure = (value: unknown) => {
  if (!Array.isArray(value) || !value.length || value.length > 100)
    throw new RequestContractError(400, 'Provide 1–100 units');
  const ids = new Set<string>();
  const id = (v: unknown) => {
    const result =
      v === undefined
        ? String(new Types.ObjectId())
        : objectIdField(v, 'structure ID');
    if (ids.has(result))
      throw new RequestContractError(400, 'Duplicate structure ID');
    ids.add(result);
    return result;
  };
  return value.map((v, index) => {
    const u = objectBody(v, ['id', 'title', 'topics']);
    if (!Array.isArray(u.topics) || !u.topics.length || u.topics.length > 100)
      throw new RequestContractError(400, 'Provide 1–100 topics per unit');
    return {
      _id: id(u.id),
      title: textField(u.title, 'unit title', 200, 1),
      order: index + 1,
      topics: u.topics.map((topicInput, i) => {
        const t = objectBody(topicInput, ['id', 'title', 'outcomes']);
        const outcomes = t.outcomes ?? [];
        if (!Array.isArray(outcomes) || outcomes.length > 30)
          throw new RequestContractError(400, 'Invalid outcomes');
        return {
          _id: id(t.id),
          title: textField(t.title, 'topic title', 200, 1),
          order: i + 1,
          outcomes: outcomes.map(o => textField(o, 'outcome', 1000, 1)),
        };
      }),
    };
  });
};
export const syllabusDTO = (s: InstanceType<typeof Syllabus>) => ({
  syllabusId: String(s._id),
  classId: String(s.classId),
  subjectId: String(s.subjectId),
  academicYear: s.academicYear,
  title: s.title,
  version: s.version,
  revision: s.revision,
  status: s.status,
  publishedAt: s.publishedAt?.toISOString() ?? null,
  units: s.units.map(u => ({
    unitId: String(u._id),
    title: u.title,
    order: u.order,
    topics: u.topics.map(t => ({
      topicId: String(t._id),
      title: t.title,
      order: t.order,
      outcomes: [...t.outcomes],
    })),
  })),
});
const adminActor = async (identity: JwtPayload | undefined, session?: ClientSession) => {
  const actor = await currentAcademicActor(identity, session);
  // No existing Principal syllabus grant. Do not infer one from exam/approval authority.
  if (
    actor.role !== 'super_admin' ||
    !ROLE_PERMISSIONS[actor.role].includes(PERMISSIONS.SYLLABUS_MANAGE)
  )
    throw new RequestContractError(403, 'Syllabus management is not permitted');
  return actor;
};
// Reads and writes share the same current administrative context. The persisted
// syllabus pins branch/year; it must never be rebound to a changed class.
export const assertManagedSyllabusContext = async (
  context: {
    classId: string;
    subjectId: string;
    syllabus?: InstanceType<typeof Syllabus>;
  },
  session?: ClientSession,
  actor?: Awaited<ReturnType<typeof currentAcademicActor>>,
) => {
  const schoolClass = await SchoolClass.findById(context.classId)
    .read('primary')
    .session(session ?? null);
  if (!schoolClass?.isActive) throw academicMissing();
  const requestedBranch = context.syllabus
    ? context.syllabus.branchId?.toString() : schoolClass.branchId?.toString();
  const branchId = actor?.schoolId
    ? String((await requireAcademicBranch(actor, requestedBranch, session))._id)
    : await requireActiveAcademicBranch(requestedBranch);
  if (
    String(schoolClass.branchId) !== branchId ||
    (context.syllabus &&
      context.syllabus.academicYear !== schoolClass.academicYear) ||
    !(await Subject.exists({ _id: context.subjectId, branchId, isActive: true })
      .read('primary')
      .session(session ?? null))
  ) {
    throw academicMissing();
  }
  return { branchId, schoolClass };
};
export const manageSyllabus = async (
  identity: JwtPayload | undefined,
  token: SessionAuthority,
  action: 'create' | 'update' | 'publish' | 'retire',
  requestedId: unknown,
  body: unknown,
) => {
  const actor = await adminActor(identity);
  const input = objectBody(
    body,
    action === 'create'
      ? ['classId', 'subjectId', 'version', 'title', 'units']
      : action === 'update'
      ? ['revision', 'title', 'units']
      : ['revision'],
  );
  const initial =
    action === 'create'
      ? null
      : await Syllabus.findById(objectIdField(requestedId, 'syllabus ID')).read(
          'primary',
        );
  if (action !== 'create' && !initial) throw academicMissing();
  const classId = initial
    ? String(initial.classId)
    : objectIdField(input.classId, 'class ID');
  const subjectId = initial
    ? String(initial.subjectId)
    : objectIdField(input.subjectId, 'subject ID');
  const context = { classId, subjectId, syllabus: initial ?? undefined };
  const { branchId } = await assertManagedSyllabusContext(context, undefined, actor);
  const session = await mongoose.startSession();
  try {
    return await authenticatedTransaction(session, async () => {
      await communicationFence(
        session,
        User.collection.name,
        String(actor._id),
      );
      await revalidateAuthenticatedSession(token, {userId: String(actor._id), role: 'super_admin'}, session);
      await communicationFence(session, Branch.collection.name, branchId);
      await communicationFence(session, SchoolClass.collection.name, classId);
      await communicationFence(session, Subject.collection.name, subjectId);
      const currentActor = await adminActor(identity, session);
      const { schoolClass: currentClass, branchId: currentBranchId } =
        await assertManagedSyllabusContext(context, session, currentActor);
      if (currentBranchId !== branchId) throw academicMissing();
      const curriculum = action === 'retire' ? null : await requireClassSubject(branchId, classId, subjectId, session);
      if (curriculum && currentClass.academicYear !== curriculum.period.code) throw new RequestContractError(409, 'Class Academic Period snapshot is inconsistent');
      if (action === 'create') {
        const row = new Syllabus({
          branchId,
          classId,
          subjectId,
          academicYear: curriculum!.period.code,
          version: revisionField(input.version),
          title: textField(input.title, 'syllabus title', 200, 1),
          units: structure(input.units),
          createdBy: actor._id,
          updatedBy: actor._id,
        });
        await row.save({ session });
        return syllabusDTO(row);
      }
      const row = await Syllabus.findOne({
        _id: initial!._id,
        branchId,
        classId,
        subjectId,
        academicYear: currentClass.academicYear,
      }).session(session);
      if (!row) throw academicMissing();
      if (row.revision !== revisionField(input.revision))
        throw new RequestContractError(
          409,
          'Syllabus changed. Reload before retrying.',
        );
      if (action === 'update') {
        if (row.status !== 'draft')
          throw new RequestContractError(
            409,
            'Only drafts can be edited. Create a new version.',
          );
        row.title = textField(input.title, 'syllabus title', 200, 1);
        row.set('units', structure(input.units));
      } else if (action === 'publish') {
        if (row.status !== 'draft')
          throw new RequestContractError(409, 'Only drafts can be published');
        const published = await Syllabus.findOne({
          branchId,
          classId,
          subjectId,
          academicYear: row.academicYear,
          publishedAt: { $exists: true },
        })
          .sort({ version: -1 })
          .session(session);
        if (published && published.version >= row.version)
          throw new RequestContractError(
            409,
            'Publish a higher syllabus version',
          );
        // Branch fence is shared with lesson mutations. Replacement is atomic.
        await Syllabus.updateMany(
          {
            branchId,
            classId,
            subjectId,
            academicYear: row.academicYear,
            status: 'published',
          },
          {
            $set: {
              status: 'retired',
              retiredAt: new Date(),
              retiredBy: actor._id,
              updatedBy: actor._id,
            },
            $inc: { revision: 1 },
          },
          { session },
        );
        row.status = 'published';
        row.publishedAt = new Date();
        row.publishedBy = actor._id;
      } else {
        if (row.status !== 'published')
          throw new RequestContractError(
            409,
            'Only published syllabuses can be retired',
          );
        row.status = 'retired';
        row.retiredAt = new Date();
        row.retiredBy = actor._id;
      }
      row.revision += 1;
      row.updatedBy = actor._id;
      await row.save({ session });
      return syllabusDTO(row);
    });
  } catch (e) {
    if ((e as { code?: number })?.code === 11000)
      throw new RequestContractError(
        409,
        'This syllabus version already exists',
      );
    throw e;
  } finally {
    await session.endSession();
  }
};
export const academicScope = async (identity: JwtPayload | undefined) => {
  if (!ROLE_PERMISSIONS.teacher.includes(PERMISSIONS.TEACHER_ACADEMIC_VIEW))
    throw new RequestContractError(403, 'Academic access is not permitted');
  return getTeacherScope(identity);
};
export const teacherAcademicContext = async (
  identity: JwtPayload | undefined,
  context: unknown,
) => {
  const input = objectBody(context, ['classId', 'sectionId', 'subjectId']);
  const ids = {
    classId: objectIdField(input.classId, 'class ID'),
    sectionId: objectIdField(input.sectionId, 'section ID'),
    subjectId: objectIdField(input.subjectId, 'subject ID'),
  };
  const scope = await academicScope(identity),
    tuple = exactTuple(scope, ids);
  const c = await SchoolClass.findOne({ isActive: true })
    .where('_id')
    .equals(tuple.classId)
    .where('branchId')
    .equals(scope.branchId)
    .read('primary');
  if (!c) throw academicMissing();
  const syllabus = await Syllabus.findOne({
    branchId: scope.branchId,
    classId: tuple.classId,
    subjectId: tuple.subjectId,
    academicYear: c.academicYear,
    status: 'published',
  }).read('primary');
  const teacher = await User.findById(scope.actorId)
    .select('fullName')
    .read('primary');
  return {
    scope,
    tuple,
    academicYear: c.academicYear,
    teacherName: teacher?.fullName ?? 'Teacher',
    syllabus,
  };
};
export const getAcademicContext = async (
  identity: JwtPayload | undefined,
  context: unknown,
  syllabusId?: unknown,
) => {
  const result = await teacherAcademicContext(identity, context);
  if (
    syllabusId !== undefined &&
    (!result.syllabus ||
      String(result.syllabus._id) !== objectIdField(syllabusId, 'syllabus ID'))
  )
    throw academicMissing();
  return {
    assignment: result.tuple,
    teacherName: result.teacherName,
    academicYear: result.academicYear,
    syllabus: result.syllabus ? syllabusDTO(result.syllabus) : null,
  };
};
export const listAcademicContexts = async (identity: JwtPayload | undefined) =>
  (await academicScope(identity)).tuples;
export const getManagedSyllabus = async (
  identity: JwtPayload | undefined,
  id: unknown,
) => {
  const actor = await adminActor(identity);
  const row = await Syllabus.findById(objectIdField(id, 'syllabus ID')).read(
    'primary',
  );
  if (!row) throw academicMissing();
  await assertManagedSyllabusContext({
    classId: String(row.classId),
    subjectId: String(row.subjectId),
    syllabus: row,
  }, undefined, actor);
  return syllabusDTO(row);
};
