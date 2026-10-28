import User from '../models/user';
import type {ClientSession} from 'mongoose';
import Branch from '../models/branch';
import SchoolClass from '../models/schoolClass';
import Section from '../models/section';
import Subject from '../models/subject';
import TeacherAssignment from '../models/teacherAssignment';
import type {JwtPayload} from './jwt.service';
import {objectIdField, RequestContractError} from '../utils/request-validation';
import {resolveAcademicSchool} from './school-authority.service';
import {isAuthContext, revalidateAuthenticatedSession} from './authenticated-session.service';

// Identity must come from authenticateToken, never from request body/query.
export const currentAcademicActor = async (identity: JwtPayload | undefined, session?: ClientSession) => {
  if (!identity) throw new RequestContractError(401, 'Authentication required');
  if (session && isAuthContext(identity)) await revalidateAuthenticatedSession(identity, identity, session);
  const id = objectIdField(identity.userId, 'authenticated user ID');
  const actor = await User.findById(id).session(session ?? null).read('primary').select('_id role schoolId branchId isActive active').lean();
  if (!actor || !actor.isActive || actor.active === false || actor.role !== identity.role) {
    throw new RequestContractError(401, 'User account is unavailable or authorization has changed');
  }
  return resolveAcademicSchool(actor, session);
};

export const requireActiveAcademicBranch = async (branchId: string | undefined) => {
  if (!branchId || !await Branch.exists({_id: branchId, isActive: true}).read('primary')) {
    throw new RequestContractError(403, 'Active branch scope is required');
  }
  return branchId;
};

export interface TeacherAssignmentTuple {
  assignmentId: string;
  classId: string;
  className: string;
  sectionId: string;
  sectionName: string;
  subjectId: string;
  subjectName: string;
}

// Authorization always reads the primary so mutation fences cannot be bypassed by secondary lag.
// Request-local scope only. No process/session cache: revocation, reference
// changes, permissions and branch reassignment are observed on the next request.
export const getTeacherScope = async (identity: JwtPayload | undefined) => {
  const actor = await currentAcademicActor(identity);
  if (actor.role !== 'teacher') {
    throw new RequestContractError(403, 'Teacher scope is required');
  }
  const branchId = await requireActiveAcademicBranch(actor.branchId?.toString());
  const now = new Date();
  const assignments = await TeacherAssignment.find({
    teacherId: actor._id, branchId, isActive: true, validFrom: {$lte: now},
    $or: [{validUntil: {$exists: false}}, {validUntil: {$gt: now}}],
  }).read('primary').select('_id classId sectionId subjectId').sort({_id: 1}).lean();
  if (!assignments.length) return {actorId: actor._id.toString(), branchId, tuples: [] as TeacherAssignmentTuple[]};

  const [classes, sections, subjects] = await Promise.all([
    SchoolClass.find({isActive: true}).read('primary').where('_id').in(assignments.map(item => item.classId))
      .where('branchId').equals(branchId).select('_id name').lean(),
    Section.find({isActive: true}).read('primary').where('_id').in(assignments.map(item => item.sectionId))
      .where('branchId').equals(branchId).select('_id classId name').lean(),
    Subject.find({_id: {$in: assignments.map(item => item.subjectId)}, branchId, isActive: true}).read('primary').select('_id name').lean(),
  ]);
  const classMap = new Map(classes.map(item => [String(item._id), item]));
  const sectionMap = new Map(sections.map(item => [String(item._id), item]));
  const subjectMap = new Map(subjects.map(item => [String(item._id), item]));
  const tuples: TeacherAssignmentTuple[] = [];
  for (const assignment of assignments) {
    const schoolClass = classMap.get(String(assignment.classId));
    const section = sectionMap.get(String(assignment.sectionId));
    const subject = subjectMap.get(String(assignment.subjectId));
    if (!schoolClass || !section || !subject || String(section.classId) !== String(schoolClass._id)) continue;
    tuples.push({
      assignmentId: String(assignment._id), classId: String(schoolClass._id), className: schoolClass.name,
      sectionId: String(section._id), sectionName: section.name,
      subjectId: String(subject._id), subjectName: subject.name,
    });
  }
  return {actorId: actor._id.toString(), branchId, tuples};
};
