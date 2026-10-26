import User from '../models/user';
import type {ClientSession} from 'mongoose';
import {AcademicPeriod} from '../models/academicPeriod';
import SchoolClass from '../models/schoolClass';
import Section from '../models/section';
import Subject from '../models/subject';
import TeacherAssignment, {ensureTeacherAssignmentUniqueIndex} from '../models/teacherAssignment';
import {PERMISSIONS} from '../constants/permissions';
import {ROLE_PERMISSIONS} from '../constants/rolePermissions';
import {dateField, objectBody, objectIdField, RequestContractError} from '../utils/request-validation';
import {currentAcademicActor, requireActiveAcademicBranch} from './teacher-scope.service';
import type {JwtPayload} from './jwt.service';
import {withAcademicCatalogLock} from './academic-catalog-lock.service';
import {requireClassSubject} from './class-subject-context.service';

export const provisioningActor = async (identity: JwtPayload | undefined, session?: ClientSession) => {
  const actor = await currentAcademicActor(identity, session);
  if (!['principal', 'super_admin'].includes(actor.role) ||
    !ROLE_PERMISSIONS[actor.role].includes(PERMISSIONS.TEACHER_ASSIGNMENTS_MANAGE)) {
    throw new RequestContractError(403, 'Teacher assignment management is not permitted');
  }
  if (actor.role === 'principal') await requireActiveAcademicBranch(actor.branchId?.toString());
  return actor;
};

const conceal = () => new RequestContractError(404, 'Assignment reference not found');

export const createTeacherAssignment = async (identity: JwtPayload | undefined, body: unknown) => {
  const actor = await provisioningActor(identity);
  const input = objectBody(body, ['teacherId', 'classId', 'sectionId', 'subjectId', 'validFrom', 'validUntil']);
  const teacherId = objectIdField(input.teacherId, 'teacher ID');
  const classId = objectIdField(input.classId, 'class ID');
  const sectionId = objectIdField(input.sectionId, 'section ID');
  const subjectId = objectIdField(input.subjectId, 'subject ID');
  const validFrom = dateField(input.validFrom, 'validFrom');
  const validUntil = input.validUntil === undefined ? undefined : dateField(input.validUntil, 'validUntil');
  if (validUntil && validUntil <= validFrom) throw new RequestContractError(400, 'validUntil must be after validFrom');
  const teacher = await User.findOne({
    _id: teacherId, ...(actor.role === 'principal' ? {branchId: actor.branchId} : {}),
  }).select('_id role branchId isActive').lean();
  if (!teacher) throw conceal();
  if (teacher.role !== 'teacher' || !teacher.isActive) throw new RequestContractError(403, 'Teacher is not eligible');
  const branchId = await requireActiveAcademicBranch(teacher.branchId?.toString());
  await ensureTeacherAssignmentUniqueIndex();
  return withAcademicCatalogLock(branchId, async session => {
  await User.collection.updateOne({_id: actor._id}, {$inc: {__v: 1}}, {session});
  const currentActor = await provisioningActor(identity, session);
  await User.collection.updateOne({_id: teacher._id}, {$inc: {__v: 1}}, {session});
  const currentTeacher = await User.findOne({_id: teacherId, role: 'teacher', isActive: true}).where('branchId').equals(branchId).session(session);
  if (!currentTeacher || (currentActor.role === 'principal' && String(currentActor.branchId) !== branchId)) throw conceal();
  // The MongoDB driver does not support parallel operations on one session.
  const schoolClass = await SchoolClass.findOne({isActive: true}).where('_id').equals(classId).where('branchId').equals(branchId).session(session);
  const section = await Section.exists({isActive: true}).where('_id').equals(sectionId).where('branchId').equals(branchId).where('classId').equals(classId).session(session);
  const subject = await Subject.exists({_id: subjectId, branchId, isActive: true}).session(session);
  if (!schoolClass || !section || !subject) throw conceal();
  // Keep legacy assignments usable; period-backed Classes require the current
  // active period. Lifecycle transitions participate in the same Branch fence.
  if (schoolClass.academicPeriodId && !await AcademicPeriod.exists({_id: schoolClass.academicPeriodId, branchId, status: 'active'}).session(session)) {
    throw new RequestContractError(409, 'An active Academic Period is required');
  }
  // NEW assignments require explicit curriculum; historical reads are unchanged.
  await requireClassSubject(branchId, classId, subjectId, session);
  // Fail closed even if production disables Mongoose autoIndex. No find-then-save
  // duplicate check: MongoDB arbitrates simultaneous equivalent creates.
  try {
    const [assignment] = await TeacherAssignment.create([{
      teacherId, branchId, classId, sectionId, subjectId, validFrom, validUntil,
      createdBy: actor._id, updatedBy: actor._id,
    }], {session});
    return {assignmentId: String(assignment._id), isActive: assignment.isActive};
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
      throw new RequestContractError(409, 'An active assignment already reserves this tuple; revoke it before replacement');
    }
    throw error;
  }
  });
};

export const revokeTeacherAssignment = async (identity: JwtPayload | undefined, id: unknown, body: unknown) => {
  const actor = await provisioningActor(identity);
  const assignmentId = objectIdField(id, 'assignment ID');
  objectBody(body, []);
  const query = TeacherAssignment.findById(assignmentId);
  if (actor.role === 'principal') query.where('branchId').equals(actor.branchId);
  const assignment = await query.select('_id branchId isActive');
  if (!assignment) throw new RequestContractError(404, 'Teacher assignment not found');
  // Revocation is allowed even if the Teacher/references have since become
  // unavailable. It only removes authority; it never repairs/reassigns a tuple.
  const updated = await TeacherAssignment.findOneAndUpdate({
    _id: assignment._id, branchId: assignment.branchId, isActive: true,
  }, {$set: {isActive: false, revokedAt: new Date(), updatedBy: actor._id}, $inc: {__v: 1}},
  {returnDocument: 'after', runValidators: true});
  if (!updated) throw new RequestContractError(409, 'Teacher assignment is already revoked');
  return {assignmentId: String(updated._id), isActive: updated.isActive};
};
