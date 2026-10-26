import mongoose from 'mongoose';
import {StudentEnrollment} from '../models/studentEnrollment';
import User from '../models/user';
import {PERMISSIONS} from '../constants/permissions';
import {ROLE_PERMISSIONS} from '../constants/rolePermissions';

import Branch from '../models/branch';
import SchoolClass from '../models/schoolClass';
import Section from '../models/section';
import Student, {IStudent} from '../models/student';
import {withTimetablePublication} from './teacher-timetable.service';
import {AcademicPeriod} from '../models/academicPeriod';
import {RequestContractError} from '../utils/request-validation';

export interface CreateStudentInput {
  createdBy: string;
  userId: string;
  branchId: string;
  classId: string;
  sectionId: string;
  admissionNumber: string;
  dateOfBirth?: Date;
  gender?: 'male' | 'female' | 'other';
  guardianName?: string;
  guardianPhone?: string;
  address?: string;
}

export const createStudent = async (
  data: CreateStudentInput,
  options?: {session: mongoose.ClientSession; authorityFencedExternally: true},
): Promise<IStudent> => {
  if (options && !options.session.inTransaction()) throw new RequestContractError(503, 'Student admission requires a transaction');
  const userId = data.userId.trim();
  const branchId = data.branchId.trim();
  const classId = data.classId.trim();
  const sectionId = data.sectionId.trim();
  const admissionNumber = data.admissionNumber.trim().toUpperCase();

  if (
    !userId ||
    !branchId ||
    !classId ||
    !sectionId ||
    !admissionNumber
  ) {
    throw new Error(
      'User, branch, class, section and admission number are required',
    );
  }

  if (
    !mongoose.isValidObjectId(userId) ||
    !mongoose.isValidObjectId(branchId) ||
    !mongoose.isValidObjectId(classId) ||
    !mongoose.isValidObjectId(sectionId)
  ) {
    throw new Error('Invalid student reference ID');
  }

  const branchObjectId = new mongoose.Types.ObjectId(branchId);
  const classObjectId = new mongoose.Types.ObjectId(classId);
  const sectionObjectId = new mongoose.Types.ObjectId(sectionId);

  const branch = await Branch.findById(branchObjectId).select('_id isActive').session(options?.session ?? null);

  if (!branch || !branch.isActive) {
    throw new Error('Assigned branch not found or inactive');
  }

  const schoolClass = await SchoolClass.findById(classObjectId).select(
    '_id branchId isActive',
  ).session(options?.session ?? null);

  if (!schoolClass || !schoolClass.isActive) {
    throw new Error('Assigned class not found or inactive');
  }

  if (schoolClass.branchId.toString() !== branchId) {
    throw new Error('Class does not belong to the assigned branch');
  }

  const section = await Section.findById(sectionObjectId).select(
    '_id branchId classId isActive',
  ).session(options?.session ?? null);

  if (!section || !section.isActive) {
    throw new Error('Assigned section not found or inactive');
  }

  if (
    section.branchId.toString() !== branchId ||
    section.classId.toString() !== classId
  ) {
    throw new Error(
      'Section does not belong to the assigned class and branch',
    );
  }

  const existingStudent = await Student.collection.findOne({
  branchId: branchObjectId,
  admissionNumber,
}, options ? {session: options.session} : {});

if (existingStudent) {
  throw new Error(
    'Student with this admission number already exists in this branch',
  );
}

  const student = new Student({
    userId: new mongoose.Types.ObjectId(userId),
    branchId: branchObjectId,
    classId: classObjectId,
    sectionId: sectionObjectId,
    admissionNumber,
    dateOfBirth: data.dateOfBirth,
    gender: data.gender,
    guardianName: data.guardianName?.trim(),
    guardianPhone: data.guardianPhone?.trim(),
    address: data.address?.trim(),
    isActive: true,
  });

  // Attendance mutations hold this same branch fence. New enrollment must not
  // appear as an unfenced phantom between roster validation and commit.
  // A fresh document per driver transaction attempt preserves insert semantics
  // after a retry; the initially allocated ID remains stable.
  const write = async (session: mongoose.ClientSession) => {
    // This transaction writes the same Branch fence as Academic Setup. Repeat
    // reference validation after that write so deactivation cannot slip between
    // the early form validation and enrollment commit.
    const currentClass = await SchoolClass.findOne({isActive: true}).where('_id').equals(classId).where('branchId').equals(branchId).session(session);
    const currentSection = await Section.exists({isActive: true}).where('_id').equals(sectionId).where('branchId').equals(branchId).where('classId').equals(classId).session(session);
    if (!currentClass || !currentSection) throw new RequestContractError(409, 'Student Class or Section is no longer active');
    if (!currentClass.academicPeriodId) throw new RequestContractError(409, 'Migrate the legacy Class to an Academic Period before new admission');
    if (currentClass.academicPeriodId && !await AcademicPeriod.exists({_id: currentClass.academicPeriodId, branchId, status: 'active'}).session(session)) {
      throw new RequestContractError(409, 'An active Academic Period is required');
    }
    if (!mongoose.isValidObjectId(data.createdBy)) throw new RequestContractError(400, 'Admission actor is required');
    if (!options) await User.collection.updateOne({_id: new mongoose.Types.ObjectId(data.createdBy)}, {$inc: {__v: 1}}, {session});
    const admissionActor = await User.findById(data.createdBy).session(session).lean();
    if (!admissionActor?.isActive || !['principal', 'super_admin'].includes(admissionActor.role) || !ROLE_PERMISSIONS[admissionActor.role].includes(PERMISSIONS.ENROLLMENT_MANAGE) || (admissionActor.role === 'principal' && String(admissionActor.branchId) !== branchId) || (admissionActor.role === 'super_admin' && admissionActor.branchId)) throw new RequestContractError(403, 'Admission actor is unavailable');
    await User.collection.updateOne({_id: new mongoose.Types.ObjectId(userId)}, {$inc: {__v: 1}}, {session});
    const identity = await User.findOne({role: 'student', isActive: true}).where('_id').equals(userId).where('branchId').equals(branchId).session(session).select('_id');
    if (!identity) throw new RequestContractError(404, 'Student identity is unavailable');
    const created = await new Student(student.toObject()).save({session});
    await StudentEnrollment.create([{studentId: String(created._id), branchId, academicPeriodId: String(currentClass.academicPeriodId), classId, sectionId, effectiveFrom: new Date(), reason: 'Initial admission through student provisioning', createdBy: admissionActor._id, updatedBy: admissionActor._id}], {session});
    return created;
  };
  // Admission owns the complete User + Student + Enrollment transaction and
  // fences its authenticated actor before commit. Legacy internal callers keep
  // the existing publication transaction and actor checks.
  return options ? write(options.session) : withTimetablePublication(branchId, undefined, write);
};
