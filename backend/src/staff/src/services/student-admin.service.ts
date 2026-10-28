import { createHmac, randomBytes } from 'node:crypto';
import mongoose, { type ClientSession } from 'mongoose';
import User from '../models/user';
import Student from '../models/student';
import Branch from '../models/branch';
import {
  StudentEnrollment,
  EnrollmentOperation,
} from '../models/studentEnrollment';
import { PERMISSIONS, type Permission } from '../constants/permissions';
import { ROLE_PERMISSIONS } from '../constants/rolePermissions';
import {
  objectBody,
  objectIdField,
  textField,
  dateField,
  RequestContractError,
} from '../utils/request-validation';
import { currentAcademicActor } from './teacher-scope.service';
import type { JwtPayload } from './jwt.service';
import { withPrincipalWriteAuthority } from './principal-write-access.service';
import { teacherAccountBody } from './teacher-provisioning.service';
import { createUser } from './auth.service';
import { createStudent } from './student.service';
import { enrollmentTarget, enrollmentDTO } from './student-enrollment.service';
import { schoolToday } from './school-date.service';

const FALLBACK_OPERATION_HMAC_KEY = randomBytes(32);

const missing = () =>
  new RequestContractError(404, 'Student profile is unavailable');
const duplicate = () =>
  new RequestContractError(
    409,
    'Admission number or account email is already in use. Search Students before admitting again.',
  );
function permitted(permission: Permission) {
  for (const grant of [
    permission,
    PERMISSIONS.STUDENTS_VIEW,
    PERMISSIONS.ENROLLMENT_VIEW,
    ...(permission === PERMISSIONS.STUDENTS_CREATE
      ? [PERMISSIONS.ENROLLMENT_MANAGE]
      : []),
  ])
    if (!ROLE_PERMISSIONS.principal.includes(grant))
      throw new RequestContractError(
        403,
        'Student administration permission is required',
      );
}
async function scope(
  identity: JwtPayload | undefined,
  permission: Permission,
  session?: ClientSession,
) {
  const actor = await currentAcademicActor(identity, session);
  if (actor.role !== 'principal' || !actor.branchId)
    throw new RequestContractError(
      403,
      'Principal Branch authority is required',
    );
  permitted(permission);
  const branchId = String(actor.branchId);
  if (
    !(await Branch.exists({ _id: branchId, isActive: true }).session(
      session ?? null,
    ))
  )
    throw new RequestContractError(403, 'Active Branch authority is required');
  return { actorId: String(actor._id), branchId };
}
const profileFields = [
  'fullName',
  'admissionNumber',
  'dateOfBirth',
  'gender',
  'guardianName',
  'guardianPhone',
  'address',
  'phone',
] as const;
function profileBody(body: Record<string, unknown>, complete = false) {
  const result: Record<string, string | Date | undefined> = {};
  for (const name of profileFields) {
    if (!complete && !(name in body)) continue;
    const value = body[name];
    if (name === 'fullName' || name === 'admissionNumber') {
      result[name] = textField(
        value,
        name === 'fullName' ? 'Student name' : 'admission number',
        name === 'fullName' ? 100 : 80,
        name === 'fullName' ? 2 : 1,
      );
      if (name === 'admissionNumber')
        result[name] = String(result[name]).toUpperCase();
    } else if (name === 'dateOfBirth') {
      if (value === '' || value === undefined) result[name] = undefined;
      else {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
          throw new RequestContractError(
            400,
            'Use YYYY-MM-DD for date of birth',
          );
        const date = dateField(value, 'date of birth', true);
        if (value > schoolToday())
          throw new RequestContractError(
            400,
            'Date of birth cannot be in the future',
          );
        result[name] = date;
      }
    } else if (name === 'gender') {
      if (
        value !== undefined &&
        value !== '' &&
        (typeof value !== 'string' ||
          !['male', 'female', 'other'].includes(value))
      )
        throw new RequestContractError(400, 'Invalid gender');
      result[name] = value ? String(value) : undefined;
    } else {
      result[name] =
        value === undefined || value === ''
          ? undefined
          : textField(
              value,
              name,
              name === 'address'
                ? 255
                : name.includes('Phone') || name === 'phone'
                ? 25
                : 100,
              1,
            );
      if (
        (name === 'guardianPhone' || name === 'phone') &&
        result[name] &&
        !/^\+?[0-9 ()-]{6,25}$/.test(String(result[name]))
      )
        throw new RequestContractError(
          400,
          'Enter a valid contact phone number',
        );
    }
  }
  return result;
}
async function detail(branchId: string, id: string, session?: ClientSession) {
  const row = await Student.findOne()
    .where('_id')
    .equals(id)
    .where('branchId')
    .equals(branchId)
    .session(session ?? null)
    .lean();
  if (!row) throw missing();
  const user = await User.findOne({ role: 'student' })
    .where('_id')
    .equals(String(row.userId))
    .where('branchId')
    .equals(branchId)
    .session(session ?? null)
    .select('fullName email phone isActive')
    .lean();
  if (!user) throw missing();
  return {
    student: {
      id: String(row._id),
      fullName: user.fullName,
      admissionNumber: row.admissionNumber,
      email: user.email,
      phone: user.phone ?? '',
      dateOfBirth: row.dateOfBirth?.toISOString().slice(0, 10) ?? '',
      gender: row.gender ?? '',
      guardianName: row.guardianName ?? '',
      guardianPhone: row.guardianPhone ?? '',
      address: row.address ?? '',
      isActive: row.isActive && user.isActive,
      revision: row.__v ?? 0,
    },
    capabilities: {
      editProfile: ROLE_PERMISSIONS.principal.includes(
        PERMISSIONS.STUDENTS_UPDATE,
      ),
    },
  };
}
export async function studentProfile(
  identity: JwtPayload | undefined,
  id: unknown,
  query: unknown,
) {
  objectBody(query, []);
  const ctx = await scope(identity, PERMISSIONS.STUDENTS_VIEW);
  return detail(ctx.branchId, objectIdField(id, 'Student ID'));
}
export async function admitStudent(
  identity: JwtPayload | undefined,
  token: string,
  query: unknown,
  body: unknown,
) {
  objectBody(query, []);
  const ctx = await scope(identity, PERMISSIONS.STUDENTS_CREATE);
  const input = objectBody(body, [
    ...profileFields,
    'email',
    'password',
    'academicPeriodId',
    'classId',
    'sectionId',
    'operationId',
  ]);
  const profile = profileBody(input, true);
  const account = teacherAccountBody({
    fullName: profile.fullName,
    email: input.email,
    password: input.password,
    branchId: ctx.branchId,
  });
  const operationId =
    'admission_' + textField(input.operationId, 'operation identity', 80, 16);
  if (!/^[A-Za-z0-9_-]+$/.test(operationId))
    throw new RequestContractError(400, 'Invalid operation identity');
  // Credentials are never stored in the operation result/log. A keyed digest
  // prevents password guessing from an ordinary request-fingerprint record.
  const hmacKey = process.env.JWT_SECRET && process.env.JWT_SECRET.trim().length > 0
    ? process.env.JWT_SECRET
    : FALLBACK_OPERATION_HMAC_KEY;
  const fingerprint = createHmac('sha256', hmacKey)
    .update(
      JSON.stringify([
        profile,
        account.email,
        account.password,
        input.academicPeriodId,
        input.classId,
        input.sectionId,
      ]),
    )
    .digest('hex');
  try {
    return await withPrincipalWriteAuthority(
      { ...ctx, token },
      PERMISSIONS.STUDENTS_CREATE,
      async session => {
        const current = await scope(
          identity,
          PERMISSIONS.STUDENTS_CREATE,
          session,
        );
        if (current.branchId !== ctx.branchId)
          throw new RequestContractError(
            403,
            'Student Branch authority has changed',
          );
        const prior = await EnrollmentOperation.findOne({
          branchId: ctx.branchId,
          actorId: ctx.actorId,
          operationId,
          'result.kind': 'admission',
        })
          .session(session)
          .lean();
        if (prior) {
          if (prior.fingerprint !== fingerprint)
            throw new RequestContractError(
              409,
              'This admission request changed. Start a new admission after checking Students.',
            );
          return {
            ...(await detail(ctx.branchId, String(prior.studentId), session)),
            replayed: true,
          };
        }
        await enrollmentTarget(
          ctx.branchId,
          input.academicPeriodId,
          input.classId,
          input.sectionId,
          session,
        );
        if (
          (await Student.exists({
            admissionNumber: String(profile.admissionNumber),
          })
            .where('branchId')
            .equals(ctx.branchId)
            .session(session)) ||
          (await User.exists({ email: account.email }).session(session))
        )
          throw duplicate();
        const user = await createUser(
          {
            ...account,
            phone: profile.phone as string | undefined,
            role: 'student',
          },
          { session },
        );
        const created = await createStudent(
          {
            createdBy: ctx.actorId,
            userId: String(user._id),
            branchId: ctx.branchId,
            classId: objectIdField(input.classId, 'Class ID'),
            sectionId: objectIdField(input.sectionId, 'Section ID'),
            admissionNumber: String(profile.admissionNumber),
            dateOfBirth: profile.dateOfBirth as Date | undefined,
            gender: profile.gender as 'male' | 'female' | 'other' | undefined,
            guardianName: profile.guardianName as string | undefined,
            guardianPhone: profile.guardianPhone as string | undefined,
            address: profile.address as string | undefined,
          },
          { session, authorityFencedExternally: true },
        );
        const id = String(
          (created as unknown as { _id: mongoose.Types.ObjectId })._id,
        );
        await EnrollmentOperation.create(
          [
            {
              branchId: ctx.branchId,
              actorId: ctx.actorId,
              studentId: id,
              operationId,
              fingerprint,
              result: { kind: 'admission' },
            },
          ],
          { session },
        );
        const enrollment = await StudentEnrollment.findOne({
          studentId: id,
          branchId: ctx.branchId,
          status: 'active',
        })
          .session(session)
          .lean();
        if (!enrollment)
          throw new RequestContractError(
            409,
            'Initial enrollment could not be confirmed',
          );
        return {
          ...(await detail(ctx.branchId, id, session)),
          initialEnrollment: await enrollmentDTO(enrollment, session),
          replayed: false,
        };
      },
      async () => {
        permitted(PERMISSIONS.STUDENTS_CREATE);
      },
    );
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw duplicate();
    throw error;
  }
}
export async function editStudentProfile(
  identity: JwtPayload | undefined,
  token: string,
  id: unknown,
  query: unknown,
  body: unknown,
) {
  objectBody(query, []);
  const ctx = await scope(identity, PERMISSIONS.STUDENTS_UPDATE);
  const studentId = objectIdField(id, 'Student ID');
  const input = objectBody(body, [...profileFields, 'revision']);
  if (!Number.isSafeInteger(input.revision) || Number(input.revision) < 0)
    throw new RequestContractError(400, 'Profile revision is required');
  const values = profileBody(input);
  if (!Object.keys(values).length)
    throw new RequestContractError(400, 'Enter a profile change');
  try {
    return await withPrincipalWriteAuthority(
      { ...ctx, token },
      PERMISSIONS.STUDENTS_UPDATE,
      async session => {
        const row = await Student.findOne()
          .where('_id')
          .equals(studentId)
          .where('branchId')
          .equals(ctx.branchId)
          .session(session)
          .lean();
        if (!row) throw missing();
        if ((row.__v ?? 0) !== input.revision)
          throw new RequestContractError(
            409,
            'Student profile changed. Refresh before editing again.',
          );
        const set: Record<string, unknown> = {},
          unset: Record<string, 1> = {};
        for (const [key, value] of Object.entries(values))
          if (!['fullName', 'phone'].includes(key)) {
            if (value === undefined) unset[key] = 1;
            else set[key] = value;
          }
        const changed = await Student.updateOne(
          {},
          { $set: set, $unset: unset, $inc: { __v: 1 } },
          { session, runValidators: true },
        )
          .where('_id')
          .equals(row._id)
          .where('branchId')
          .equals(ctx.branchId)
          .where('__v')
          .equals(row.__v ?? { $exists: false });
        if (!changed.matchedCount)
          throw new RequestContractError(
            409,
            'Student profile changed. Refresh before saving.',
          );
        const user = await User.updateOne(
          { role: 'student' },
          {
            $set: {
              ...(values.fullName !== undefined
                ? { fullName: values.fullName }
                : {}),
              ...('phone' in values ? { phone: values.phone ?? '' } : {}),
            },
            $inc: { __v: 1 },
          },
          { session, runValidators: true },
        )
          .where('_id')
          .equals(String(row.userId))
          .where('branchId')
          .equals(ctx.branchId);
        if (!user.matchedCount) throw missing();
        return detail(ctx.branchId, studentId, session);
      },
      async () => {
        permitted(PERMISSIONS.STUDENTS_UPDATE);
      },
    );
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw duplicate();
    throw error;
  }
}
