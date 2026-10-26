import type { ClientSession } from 'mongoose';
import { AcademicPeriod } from '../models/academicPeriod';
import { ClassSubject } from '../models/classSubject';
import SchoolClass from '../models/schoolClass';
import Subject from '../models/subject';
import Branch from '../models/branch';
import { RequestContractError } from '../utils/request-validation';

// Use only at NEW operational write boundaries. Historical reads must not gain
// this requirement retroactively. Callers hold the persisted Branch fence.
export async function requireClassSubject(
  branchId: string,
  classId: string,
  subjectId: string,
  session?: ClientSession,
) {
  if (
    !(await Branch.exists({ _id: branchId, isActive: true }).session(
      session ?? null,
    ))
  )
    throw new RequestContractError(
      404,
      'Academic curriculum context is unavailable',
    );
  const schoolClass = await SchoolClass.findOne({ isActive: true })
    .where('_id')
    .equals(classId)
    .where('branchId')
    .equals(branchId)
    .session(session ?? null)
    .lean();
  if (!schoolClass)
    throw new RequestContractError(
      404,
      'Academic curriculum context is unavailable',
    );
  if (!schoolClass.academicPeriodId)
    throw new RequestContractError(
      409,
      'This legacy Class needs an Academic Period migration before new curriculum work',
    );
  const period = await AcademicPeriod.findOne({
    _id: schoolClass.academicPeriodId,
    branchId,
  })
    .session(session ?? null)
    .lean();
  if (!period)
    throw new RequestContractError(
      404,
      'Academic curriculum context is unavailable',
    );
  if (period.status !== 'active')
    throw new RequestContractError(
      409,
      'An active Academic Period is required',
    );
  if (
    !(await Subject.exists({
      _id: subjectId,
      branchId,
      isActive: true,
    }).session(session ?? null))
  )
    throw new RequestContractError(
      404,
      'Academic curriculum context is unavailable',
    );
  const mapping = await ClassSubject.findOne({
    branchId,
    academicPeriodId: period._id,
    classId,
    subjectId,
    isActive: true,
  })
    .session(session ?? null)
    .lean();
  if (!mapping)
    throw new RequestContractError(
      409,
      'This Subject is not available for the Class. Ask Principal to configure Class Subjects.',
    );
  return { schoolClass, period, mapping };
}
