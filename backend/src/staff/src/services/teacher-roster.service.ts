import {enrollmentMembership} from './enrollment-membership.service';
import mongoose from 'mongoose';
import Student from '../models/student';
import User from '../models/user';
import type {JwtPayload} from './jwt.service';
import {classScope} from './teacher-class.service';
import {objectIdField, RequestContractError} from '../utils/request-validation';

export interface TeacherRosterStudent {
  studentId: string;
  fullName: string;
  admissionNumber: string;
}

// Resolve the existing request-local tuple authority exactly once. Membership
// comes from current enrollment, never from a subject or caller identity claim.
export const getTeacherRoster = async (identity: JwtPayload | undefined, requested: {
  classId: unknown; sectionId: unknown; subjectId: unknown;
}) => {
  const classId = objectIdField(requested.classId, 'class ID');
  const sectionId = objectIdField(requested.sectionId, 'section ID');
  const subjectId = objectIdField(requested.subjectId, 'subject ID');
  const scope = await classScope(identity);
  const assignment = scope.tuples.find(tuple => tuple.classId === classId &&
    tuple.sectionId === sectionId && tuple.subjectId === subjectId);
  if (!assignment) throw new RequestContractError(404, 'Assigned class not found');

  // A single scoped aggregate with an explicit identity projection; no guardian
  // population, full User documents, or per-learner authorization queries.
  const students = await Student.aggregate<TeacherRosterStudent>([
    ...enrollmentMembership(scope.branchId, classId, sectionId),
    {$project: {_id: 1, userId: 1, admissionNumber: 1}},
    {$lookup: {from: User.collection.name, localField: 'userId', foreignField: '_id',
      pipeline: [{$match: {isActive: true, role: 'student', branchId: new mongoose.Types.ObjectId(scope.branchId)}},
        {$project: {_id: 0, fullName: 1}}], as: 'identity'}},
    {$unwind: '$identity'},
    {$sort: {admissionNumber: 1, _id: 1}},
    {$project: {_id: 0, studentId: {$toString: '$_id'}, fullName: '$identity.fullName', admissionNumber: 1}},
  ]);
  return {assignment, students: students.map(student => ({
    studentId: student.studentId, fullName: student.fullName, admissionNumber: student.admissionNumber,
  }))};
};
