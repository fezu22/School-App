import User from '../models/user';
import Branch from '../models/branch';
import SchoolClass from '../models/schoolClass';
import {AcademicPeriod} from '../models/academicPeriod';
import {ClassSubject} from '../models/classSubject';
import Section from '../models/section';
import Subject from '../models/subject';
import TeacherAssignment from '../models/teacherAssignment';
import { provisioningActor } from './teacher-assignment.service';
import type { JwtPayload } from './jwt.service';
import {requireAcademicBranch, schoolBranchFilter, schoolUserFilter} from './school-authority.service';
import {
  objectBody,
  objectIdField,
  RequestContractError,
  textField,
} from '../utils/request-validation';

export const ensureAssignmentAdminIndexes = () => Promise.all([
  User.collection.createIndex({branchId: 1, role: 1, isActive: 1, fullName: 1, _id: 1}, {name: 'assignment_admin_teacher_options'}),
  TeacherAssignment.collection.createIndex({teacherId: 1, branchId: 1, createdAt: -1, _id: -1}, {name: 'assignment_admin_teacher_history'}),
]);

const missing = () =>
  new RequestContractError(404, 'The selected academic scope is unavailable');
const offsetOf = (value: unknown) => {
  if (value === undefined) return 0;
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,5})$/.test(value))
    throw new RequestContractError(400, 'Invalid page offset');
  return Number(value);
};
const teacherDTO = (u: {
  _id: unknown;
  fullName: string;
  email: string;
  branchId?: unknown;
  isActive: boolean;
}) => ({
  teacherId: String(u._id),
  fullName: u.fullName,
  email: u.email,
  branchId: String(u.branchId),
  isActive: u.isActive,
});

export const getAssignmentOptions = async (
  identity: JwtPayload | undefined,
  query: unknown,
) => {
  const actor = await provisioningActor(identity);
  const input = objectBody(query, [
    'branchId',
    'teacherId',
    'classId',
    'search',
    'offset',
  ]);
  const offset = offsetOf(input.offset);
  const teacherId =
    input.teacherId === undefined
      ? undefined
      : objectIdField(input.teacherId, 'Teacher ID');
  const selected = teacherId
    ? await User.findOne({
        _id: teacherId,
        role: 'teacher',
        ...schoolUserFilter(actor),
        ...(actor.role === 'principal' ? { branchId: actor.branchId } : {}),
      })
        .select('_id fullName email branchId isActive')
        .lean()
    : null;
  if (teacherId && !selected) throw missing();
  const requested =
    input.branchId === undefined
      ? undefined
      : objectIdField(input.branchId, 'branch ID');
  const branchId =
    actor.role === 'principal'
      ? String(actor.branchId)
      : requested ?? selected?.branchId?.toString();
  if (
    (actor.role === 'principal' && requested && requested !== branchId) ||
    (selected && branchId !== String(selected.branchId))
  )
    throw missing();
  const branchQuery = Branch.find({ isActive: true, active: {$ne: false}, ...schoolBranchFilter(actor) });
  if (actor.role === 'principal')
    branchQuery.where('_id').equals(actor.branchId);
  const branches = await branchQuery
    .select('_id name code')
    .sort({ name: 1, _id: 1 })
    .limit(200)
    .lean();
  const target = branchId
    ? await requireAcademicBranch(actor, branchId)
    : null;
  if (branchId && !target) throw missing();
  if (target && !branches.some(b => String(b._id) === branchId))
    branches.push(target);
  const activeBranches = branches.map(b => b._id);
  const search =
    input.search === undefined
      ? ''
      : textField(input.search, 'Teacher search', 254);
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const filter = {
    role: 'teacher' as const,
    isActive: true,
    ...schoolUserFilter(actor),
    ...(search
      ? {
          $and: [{$or: [
            { fullName: { $regex: escaped, $options: 'i' } },
            { email: { $regex: escaped, $options: 'i' } },
          ]}],
        }
      : {}),
  };
  const [teachers, total] = await Promise.all([
    User.find(filter)
      .where('branchId')
      .equals(branchId ?? { $in: activeBranches })
      .select('_id fullName email branchId isActive')
      .sort({ fullName: 1, _id: 1 })
      .skip(offset)
      .limit(20)
      .lean(),
    User.countDocuments(filter)
      .where('branchId')
      .equals(branchId ?? { $in: activeBranches }),
  ]);
  const classId =
    input.classId === undefined
      ? undefined
      : objectIdField(input.classId, 'class ID');
  if (
    classId &&
    (!branchId ||
      !(await SchoolClass.exists({ isActive: true })
        .where('_id')
        .equals(classId)
        .where('branchId')
        .equals(branchId)))
  )
    throw missing();
  const currentPeriod = branchId ? await AcademicPeriod.findOne({branchId, status: 'active'}).select('_id').lean() : null;
  const curriculum = classId && currentPeriod ? await ClassSubject.find({branchId, classId, academicPeriodId: currentPeriod._id, isActive: true}).select('subjectId').lean() : [];
  const [classes, sections, subjects] = await Promise.all([
    branchId && currentPeriod
      ? SchoolClass.find({ isActive: true }).where('academicPeriodId').equals(currentPeriod._id)
          .where('branchId')
          .equals(branchId)
          .select('_id name code academicYear')
          .sort({ name: 1 })
          .limit(200)
          .lean()
      : [],
    classId
      ? Section.find({ isActive: true })
          .where('branchId')
          .equals(branchId)
          .where('classId')
          .equals(classId)
          .select('_id name code')
          .sort({ name: 1 })
          .limit(200)
          .lean()
      : [],
    classId && currentPeriod
      ? Subject.find({ isActive: true, _id: {$in: curriculum.map(row => row.subjectId)} })
          .where('branchId')
          .equals(branchId)
          .select('_id name')
          .sort({ name: 1 })
          .limit(200)
          .lean()
      : [],
  ]);
  const option = (item: { _id: unknown; name: string }) => ({
    id: String(item._id),
    name: item.name,
  });
  return {
    branchId: branchId ?? null,
    branchFixed: actor.role === 'principal',
    branches: branches.map(b => ({
      id: String(b._id),
      name: b.name,
      code: b.code,
    })),
    teachers: {
      items: teachers.map(teacherDTO),
      total,
      nextOffset:
        offset + teachers.length < total ? offset + teachers.length : null,
    },
    selectedTeacher: selected ? teacherDTO(selected) : null,
    classes: classes.map(c => ({
      id: String(c._id),
      name: `${c.name} (${c.code}, ${c.academicYear})`,
    })),
    sections: sections.map(s => ({
      id: String(s._id),
      name: s.code === s.name ? s.name : `${s.name} (${s.code})`,
    })),
    subjects: subjects.map(option),
  };
};

export const getManagedTeacherAssignments = async (
  identity: JwtPayload | undefined,
  id: unknown,
  query: unknown,
) => {
  const actor = await provisioningActor(identity);
  const teacherId = objectIdField(id, 'Teacher ID');
  const input = objectBody(query, ['offset']);
  const offset = offsetOf(input.offset);
  const teacher = await User.findOne({
    _id: teacherId,
    role: 'teacher',
    ...schoolUserFilter(actor),
    ...(actor.role === 'principal' ? { branchId: actor.branchId } : {}),
  })
    .select('_id fullName email branchId isActive')
    .lean();
  if (!teacher?.branchId) throw missing();
  await requireAcademicBranch(actor, String(teacher.branchId));
  const [rows, total] = await Promise.all([
    TeacherAssignment.find()
      .where('teacherId')
      .equals(teacherId)
      .where('branchId')
      .equals(teacher.branchId)
      .select('_id classId sectionId subjectId validFrom validUntil isActive')
      .sort({ createdAt: -1, _id: -1 })
      .skip(offset)
      .limit(20)
      .lean(),
    TeacherAssignment.countDocuments()
      .where('teacherId')
      .equals(teacherId)
      .where('branchId')
      .equals(teacher.branchId),
  ]);
  const [classes, sections, subjects] = await Promise.all([
    SchoolClass.find()
      .where('_id')
      .in(rows.map(r => r.classId))
      .where('branchId')
      .equals(teacher.branchId)
      .select('_id name code academicYear isActive')
      .lean(),
    Section.find()
      .where('_id')
      .in(rows.map(r => r.sectionId))
      .where('branchId')
      .equals(teacher.branchId)
      .select('_id name code classId isActive')
      .lean(),
    Subject.find()
      .where('_id')
      .in(rows.map(r => r.subjectId))
      .where('branchId')
      .equals(teacher.branchId)
      .select('_id name isActive')
      .lean(),
  ]);
  const cm = new Map(classes.map(c => [String(c._id), c])),
    sm = new Map(sections.map(s => [String(s._id), s])),
    um = new Map(subjects.map(s => [String(s._id), s]));
  const now = new Date();
  return {
    teacher: teacherDTO(teacher),
    total,
    nextOffset: offset + rows.length < total ? offset + rows.length : null,
    items: rows.map(r => {
      const c = cm.get(String(r.classId)),
        s = sm.get(String(r.sectionId)),
        u = um.get(String(r.subjectId));
      const available =
        teacher.isActive &&
        c?.isActive &&
        s?.isActive &&
        u?.isActive &&
        String(s.classId) === String(r.classId);
      const status = !r.isActive
        ? 'revoked'
        : !available
        ? 'unavailable'
        : r.validUntil && r.validUntil <= now
        ? 'expired'
        : r.validFrom > now
        ? 'upcoming'
        : 'active';
      return {
        assignmentId: String(r._id),
        className: c
          ? `${c.name} (${c.code}, ${c.academicYear})`
          : 'Unavailable class',
        sectionName: s
          ? s.code === s.name
            ? s.name
            : `${s.name} (${s.code})`
          : 'Unavailable section',
        subjectName: u?.name ?? 'Unavailable subject',
        validFrom: r.validFrom,
        validUntil: r.validUntil ?? null,
        status,
        canRevoke: r.isActive,
      };
    }),
  };
};
