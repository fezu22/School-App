import {createHash} from 'node:crypto';
import mongoose, {type ClientSession} from 'mongoose';
import Student from '../models/student';
import User from '../models/user';
import Session from '../models/session';
import Branch from '../models/branch';
import SchoolClass from '../models/schoolClass';
import Section from '../models/section';
import {AcademicPeriod} from '../models/academicPeriod';
import {StudentEnrollment, EnrollmentOperation, activeEnrollmentFilter, activeEnrollmentExpression} from '../models/studentEnrollment';
import {PERMISSIONS, type Permission} from '../constants/permissions';
import {ROLE_PERMISSIONS} from '../constants/rolePermissions';
import {currentAcademicActor} from './teacher-scope.service';
import {withAcademicCatalogLock} from './academic-catalog-lock.service';
import {objectBody, objectIdField, textField, RequestContractError} from '../utils/request-validation';
import type {JwtPayload} from './jwt.service';
const missing = () => new RequestContractError(404, 'Student enrollment is unavailable');
const conflict = (message: string) => new RequestContractError(409, message);
const grant = {enroll: PERMISSIONS.ENROLLMENT_MANAGE, transfer: PERMISSIONS.ENROLLMENT_MANAGE, promote: PERMISSIONS.ENROLLMENT_PROMOTE, withdraw: PERMISSIONS.ENROLLMENT_WITHDRAW};
export type EnrollmentAction = keyof typeof grant;
export async function enrollmentScope(identity: JwtPayload | undefined, permission: Permission, requested: unknown, session?: ClientSession) {
  const actor = await currentAcademicActor(identity, session);
  if (!['principal', 'super_admin'].includes(actor.role) || !ROLE_PERMISSIONS[actor.role].includes(permission)) throw new RequestContractError(403, 'Student enrollment permission is required');
  let branchId: string;
  if (actor.role === 'principal') {
    if (!actor.branchId) throw new RequestContractError(403, 'Principal Branch is required');
    branchId = String(actor.branchId);
    if (requested !== undefined && objectIdField(requested, 'branch ID') !== branchId) throw missing();
  } else {
    if (actor.branchId) throw new RequestContractError(403, 'Global Super Admin authority is required');
    branchId = objectIdField(requested, 'target branch ID');
  }
  if (!await Branch.exists({_id: branchId, isActive: true}).session(session ?? null)) throw missing();
  return {actor, branchId};
}
async function studentContext(branchId: string, id: unknown, session?: ClientSession, writable = false) {
  const row = await Student.findOne().where('_id').equals(objectIdField(id, 'student ID')).where('branchId').equals(branchId).session(session ?? null).lean();
  if (!row) throw missing();
  const user = await User.findOne({role: 'student', ...(writable ? {isActive: true} : {})}).where('_id').equals(String(row.userId)).where('branchId').equals(branchId).session(session ?? null).select('fullName isActive').lean();
  if (!user || (writable && !row.isActive)) throw missing();
  return {row, user};
}
export async function enrollmentTarget(branchId: string, periodId: unknown, classId: unknown, sectionId: unknown, session: ClientSession) {
  const period = await AcademicPeriod.findOne({_id: objectIdField(periodId, 'academic period ID'), branchId}).session(session).lean();
  const schoolClass = await SchoolClass.findOne({isActive: true}).where('_id').equals(objectIdField(classId, 'class ID')).where('branchId').equals(branchId).session(session).lean();
  const section = await Section.findOne({isActive: true}).where('_id').equals(objectIdField(sectionId, 'section ID')).where('branchId').equals(branchId).where('classId').equals(schoolClass?._id).session(session).lean();
  if (!period || !schoolClass || !section || String(schoolClass.academicPeriodId) !== String(period._id)) throw missing();
  if (period.status !== 'active') throw conflict('The target Academic Period must be active');
  return {period, schoolClass, section};
}
// Only this exact active enrollment is current. Legacy projections never win
// over managed history, including when every managed record has been closed.
export const currentEnrollment = (studentId: unknown, branchId: unknown, session?: ClientSession) => StudentEnrollment.findOne(activeEnrollmentFilter()).where('effectiveTo').equals(null).where('studentId').equals(String(studentId)).where('branchId').equals(String(branchId)).session(session ?? null).lean();
export async function enrollmentDTO(row: any, session?: ClientSession) {
  const period = await AcademicPeriod.findOne({_id: row.academicPeriodId, branchId: row.branchId}).session(session ?? null).select('name code status').lean();
  const schoolClass = await SchoolClass.findOne().where('_id').equals(row.classId).where('branchId').equals(row.branchId).session(session ?? null).select('name code').lean();
  const section = await Section.findOne().where('_id').equals(row.sectionId).where('branchId').equals(row.branchId).where('classId').equals(row.classId).session(session ?? null).select('name code').lean();
  return {id: String(row._id), period: {id: String(row.academicPeriodId), name: period?.name ?? 'Unavailable period', code: period?.code ?? '', status: period?.status ?? 'unavailable'}, class: {id: String(row.classId), name: schoolClass?.name ?? 'Unavailable Class', code: schoolClass?.code ?? ''}, section: {id: String(row.sectionId), name: section?.name ?? 'Unavailable Section', code: section?.code ?? ''}, status: row.status, revision: row.revision, effectiveFrom: row.effectiveFrom.toISOString(), effectiveTo: row.effectiveTo?.toISOString() ?? null, reason: row.reason, closedReason: row.closedReason ?? null};
}
export async function enrollmentDetail(identity: JwtPayload | undefined, id: unknown, query: unknown) {
  const input = objectBody(query, ['branchId', 'offset']);
  const ctx = await enrollmentScope(identity, PERMISSIONS.ENROLLMENT_VIEW, input.branchId);
  const {row, user} = await studentContext(ctx.branchId, id);
  const offset = offsetOf(input.offset);
  const current = await currentEnrollment(row._id, ctx.branchId);
  if (!current && await StudentEnrollment.exists({studentId: row._id, branchId: ctx.branchId, status: 'active'})) throw conflict('Enrollment lifecycle is inconsistent; administrator review is required');
  const history = await StudentEnrollment.find({studentId: row._id, branchId: ctx.branchId}).sort({effectiveFrom: -1, _id: -1}).skip(offset).limit(50).lean();
  const total = await StudentEnrollment.countDocuments({studentId: row._id, branchId: ctx.branchId});
  const available = row.isActive && user.isActive;
  const currentDTO = current ? await enrollmentDTO(current) : null;
  let legacyPlacement = null;
  if (total === 0) {
    const cls = await SchoolClass.findOne().where('_id').equals(String(row.classId)).where('branchId').equals(ctx.branchId).select('name academicPeriodId').lean();
    const section = cls ? await Section.findOne().where('_id').equals(String(row.sectionId)).where('branchId').equals(ctx.branchId).where('classId').equals(cls._id).select('name').lean() : null;
    const period = cls?.academicPeriodId ? await AcademicPeriod.findOne({_id: String(cls.academicPeriodId), branchId: ctx.branchId}).select('name').lean() : null;
    if (cls && section) legacyPlacement = {className: cls.name, sectionName: section.name, periodName: period?.name ?? null};
  }
  const latest = await StudentEnrollment.findOne({studentId: row._id, branchId: ctx.branchId}).sort({effectiveFrom: -1, _id: -1}).select('status').lean();
  const permissions = ROLE_PERMISSIONS[ctx.actor.role];
  return {student: {id: String(row._id), fullName: user.fullName, admissionNumber: row.admissionNumber, isActive: available}, current: currentDTO, legacy: total === 0, legacyPlacement, history: await Promise.all(history.map(r => enrollmentDTO(r))), nextOffset: offset + history.length < total ? offset + history.length : null, actions: {enroll: available && !current && (!latest || latest.status === 'withdrawn') && permissions.includes(PERMISSIONS.ENROLLMENT_MANAGE), transfer: available && !!current && currentDTO?.period.status === 'active' && permissions.includes(PERMISSIONS.ENROLLMENT_MANAGE), promote: available && !!current && ['closed', 'archived'].includes(currentDTO?.period.status ?? '') && permissions.includes(PERMISSIONS.ENROLLMENT_PROMOTE), withdraw: available && !!current && permissions.includes(PERMISSIONS.ENROLLMENT_WITHDRAW)}};
}
function offsetOf(value: unknown) {const n = value === undefined ? 0 : Number(value); if (!Number.isSafeInteger(n) || n < 0 || n > 100000) throw new RequestContractError(400, 'Invalid page offset'); return n;}
export async function listEnrollmentStudents(identity: JwtPayload | undefined, query: unknown) {
  const input = objectBody(query, ['branchId', 'search', 'offset', 'status']);
  const ctx = await enrollmentScope(identity, PERMISSIONS.ENROLLMENT_VIEW, input.branchId);
  const search = input.search === undefined ? '' : textField(input.search, 'search', 80).toLowerCase();
  const state = input.status;
  if (state !== undefined && !['active', 'not-enrolled', 'legacy'].includes(String(state))) throw new RequestContractError(400, 'Invalid enrollment filter');
  const offset = offsetOf(input.offset);
  // Join identity and actual enrollment before filtering/pagination; projections
  // on Student are never current-enrollment authority for managed students.
  const pipeline: mongoose.PipelineStage[] = [{$match: {branchId: new mongoose.Types.ObjectId(ctx.branchId)}},
    {$lookup: {from: User.collection.name, localField: 'userId', foreignField: '_id', pipeline: [{$match: {branchId: new mongoose.Types.ObjectId(ctx.branchId), role: 'student'}}, {$project: {fullName: 1}}], as: 'identity'}}, {$unwind: '$identity'},
    {$lookup: {from: StudentEnrollment.collection.name, localField: '_id', foreignField: 'studentId', pipeline: [{$project: {status: 1, academicPeriodId: 1, classId: 1, sectionId: 1, revision: 1, effectiveFrom: 1, effectiveTo: 1, branchId: 1, reason: 1}}], as: 'enrollments'}},
    {$addFields: {current: {$arrayElemAt: [{$filter: {input: '$enrollments', as: 'e', cond: {$and: [activeEnrollmentExpression('$$e'), {$eq: ['$$e.branchId', new mongoose.Types.ObjectId(ctx.branchId)]}]}}}, 0]}, legacy: {$eq: [{$size: '$enrollments'}, 0]}}}];
  if (search) pipeline.push({$match: {$expr: {$or: [{$gte: [{$indexOfCP: [{$toLower: '$identity.fullName'}, search]}, 0]}, {$gte: [{$indexOfCP: [{$toLower: '$admissionNumber'}, search]}, 0]}]}}});
  if (state) pipeline.push({$match: state === 'legacy' ? {legacy: true} : state === 'active' ? {'current.status': 'active'} : {'current.status': {$ne: 'active'}}});
  const [page] = await Student.aggregate([...pipeline, {$sort: {admissionNumber: 1, _id: 1}}, {$facet: {items: [{$skip: offset}, {$limit: 50}], count: [{$count: 'total'}]}}]).read('primary');
  const total = page.count[0]?.total ?? 0;
  const items = [];
  for (const row of page.items) items.push({id: String(row._id), fullName: row.identity.fullName, admissionNumber: row.admissionNumber, legacy: row.legacy, current: row.current ? await enrollmentDTO(row.current) : null});
  return {items, total, nextOffset: offset + items.length < total ? offset + items.length : null};
}
export async function enrollmentOptions(identity: JwtPayload | undefined, query: unknown) {
  const input = objectBody(query, ['branchId', 'classId', 'offset']);
  const {branchId} = await enrollmentScope(identity, PERMISSIONS.ENROLLMENT_VIEW, input.branchId);
  const period = await AcademicPeriod.findOne({branchId, status: 'active'}).lean();
  const offset = offsetOf(input.offset);
  if (!period) return {period: null, classes: [], sections: [], nextOffset: null};
  const classQuery = () => SchoolClass.find({isActive: true}).where('branchId').equals(branchId).where('academicPeriodId').equals(String(period._id));
  const classes = await classQuery().sort({name: 1, _id: 1}).skip(offset).limit(50).select('name code').lean();
  const count = await classQuery().countDocuments();
  let sections: any[] = [];
  if (input.classId !== undefined) {
    const selected = await classQuery().findOne().where('_id').equals(objectIdField(input.classId, 'class ID')).lean(); if (!selected) throw missing();
    sections = await Section.find({isActive: true}).where('branchId').equals(branchId).where('classId').equals(selected._id).sort({name: 1, _id: 1}).limit(200).select('name code').lean();
  }
  return {period: {id: String(period._id), name: period.name, code: period.code}, classes: classes.map(r => ({id: String(r._id), name: r.name, code: r.code})), sections: sections.map(r => ({id: String(r._id), name: r.name, code: r.code})), nextOffset: offset + classes.length < count ? offset + classes.length : null};
}
export async function mutateEnrollment(identity: JwtPayload | undefined, token: string, studentId: unknown, enrollmentId: unknown, action: EnrollmentAction, query: unknown, body: unknown) {
  const input = objectBody(body, ['operationId', 'reason', ...(action === 'enroll' ? ['academicPeriodId', 'classId', 'sectionId'] : action === 'withdraw' ? ['revision'] : ['revision', 'academicPeriodId', 'classId', 'sectionId'])]);
  const request = objectBody(query, ['branchId']);
  const initial = await enrollmentScope(identity, grant[action], request.branchId);
  const id = objectIdField(studentId, 'student ID');
  const sourceId = action === 'enroll' ? null : objectIdField(enrollmentId, 'enrollment ID');
  const op = textField(input.operationId, 'operation ID', 80, 16);
  if (!/^[A-Za-z0-9_-]+$/.test(op)) throw new RequestContractError(400, 'Invalid operation ID');
  const reason = textField(input.reason, 'reason', 1000, 3);
  const fingerprint = createHash('sha256').update(JSON.stringify([action, sourceId, input.academicPeriodId, input.classId, input.sectionId, input.revision, reason])).digest('hex');
  try {
    return await withAcademicCatalogLock(initial.branchId, async session => {
      await User.collection.updateOne({_id: initial.actor._id}, {$inc: {__v: 1}}, {session});
      const login = await Session.collection.updateMany({token, userId: initial.actor._id, role: initial.actor.role, isRevoked: false}, {$inc: {__v: 1}}, {session});
      if (!login.matchedCount) throw new RequestContractError(401, 'Session is unavailable');
      const ctx = await enrollmentScope(identity, grant[action], request.branchId, session);
      if (ctx.branchId !== initial.branchId) throw missing();
      await Student.collection.updateOne({_id: new mongoose.Types.ObjectId(id), branchId: new mongoose.Types.ObjectId(ctx.branchId)}, {$inc: {__v: 1}}, {session});
      const before = await studentContext(ctx.branchId, id, session, true);
      await User.collection.updateOne({_id: before.row.userId}, {$inc: {__v: 1}}, {session});
      const {row: student} = await studentContext(ctx.branchId, id, session, true);
      const prior = await EnrollmentOperation.findOne({branchId: ctx.branchId, studentId: id, actorId: ctx.actor._id, operationId: op}).session(session).lean();
      if (prior) {if (prior.fingerprint !== fingerprint) throw conflict('Operation ID was reused for a different change'); return prior.result;}
      const current = await currentEnrollment(id, ctx.branchId, session);
      if (action === 'enroll' && current) throw conflict('Student already has an active enrollment');
      if (action !== 'enroll') {
        if (!await StudentEnrollment.exists({_id: sourceId!, studentId: id, branchId: ctx.branchId}).session(session)) throw missing();
        if (!current || String(current._id) !== sourceId) throw conflict('Enrollment changed; refresh before saving');
      }
      if (current && (!Number.isSafeInteger(input.revision) || input.revision !== current.revision)) throw conflict('Enrollment changed; refresh before saving');
      const previous = current ?? await StudentEnrollment.findOne({studentId: id, branchId: ctx.branchId}).sort({effectiveFrom: -1, _id: -1}).session(session).lean();
      if (action === 'enroll' && previous && previous.status !== 'withdrawn') throw conflict('Resolve the prior enrollment before readmission');
      const now = new Date();
      const target = action === 'withdraw' ? null : await enrollmentTarget(ctx.branchId, input.academicPeriodId, input.classId, input.sectionId, session);
      if (action === 'transfer' && (String(target!.period._id) !== String(current!.academicPeriodId) || String(target!.schoolClass._id) !== String(current!.classId) || String(target!.section._id) === String(current!.sectionId))) throw conflict('Section transfer requires the same active Period and Class and a different Section');
      if (action === 'promote') {
        const source = await AcademicPeriod.findOne({_id: current!.academicPeriodId, branchId: ctx.branchId}).session(session).lean();
        if (!source || !['closed', 'archived'].includes(source.status) || target!.period.startDate <= source.startDate || String(target!.period._id) === String(source._id)) throw conflict('Promotion requires a closed prior Period and a later active target Period');
      }
      if (current) {
        const checked = new StudentEnrollment({...current, status: action === 'transfer' ? 'transferred' : action === 'promote' ? 'promoted' : 'withdrawn', effectiveTo: now});
        await checked.validate();
        const closed = await StudentEnrollment.updateOne({_id: current._id, status: 'active', revision: current.revision}, {$set: {status: action === 'transfer' ? 'transferred' : action === 'promote' ? 'promoted' : 'withdrawn', effectiveTo: now, closedReason: reason, updatedBy: ctx.actor._id}, $inc: {revision: 1}}, {session});
        if (!closed.modifiedCount) throw conflict('Enrollment changed; refresh before saving');
      }
      let result;
      if (target) {
        const [created] = await StudentEnrollment.create([{studentId: id, branchId: ctx.branchId, academicPeriodId: target.period._id, classId: target.schoolClass._id, sectionId: target.section._id, status: 'active', effectiveFrom: now, reason, ...(previous ? {previousEnrollmentId: previous._id} : {}), createdBy: ctx.actor._id, updatedBy: ctx.actor._id}], {session});
        // Compatibility only. Readers for managed students resolve enrollment.
        await Student.collection.updateOne({_id: student._id}, {$set: {classId: target.schoolClass._id, sectionId: target.section._id}}, {session});
        result = {enrollment: await enrollmentDTO(created, session), action};
      } else result = {enrollment: await enrollmentDTO({...current, status: 'withdrawn', effectiveTo: now, closedReason: reason, revision: current!.revision + 1}, session), action};
      await EnrollmentOperation.create([{branchId: ctx.branchId, studentId: id, actorId: ctx.actor._id, operationId: op, fingerprint, result}], {session});
      return result;
    });
  } catch (error) {if ((error as {code?: number}).code === 11000) throw conflict('Enrollment already exists or the operation is being processed; refresh and retry'); throw error;}
}
