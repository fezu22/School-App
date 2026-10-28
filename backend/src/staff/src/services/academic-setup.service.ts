import {type SessionAuthority, revalidateAuthenticatedSession} from './authenticated-session.service';
import Room, {ROOM_CATEGORIES} from '../models/room';
import mongoose, {type ClientSession} from 'mongoose';
import {AcademicPeriod} from '../models/academicPeriod';
import {StudentEnrollment, ensureEnrollmentIndexes} from '../models/studentEnrollment';
import {ClassSubject} from '../models/classSubject';
import SchoolClass from '../models/schoolClass';
import Section from '../models/section';
import Subject from '../models/subject';
import Branch from '../models/branch';
import User from '../models/user';

import {PERMISSIONS, type Permission} from '../constants/permissions';
import {ROLE_PERMISSIONS} from '../constants/rolePermissions';
import {currentAcademicActor} from './teacher-scope.service';
import {withAcademicCatalogLock} from './academic-catalog-lock.service';
import {objectBody, objectIdField, textField, dateField, RequestContractError} from '../utils/request-validation';
import type {JwtPayload} from './jwt.service';
import {requireAcademicBranch, schoolBranchFilter} from './school-authority.service';

export type SetupKind = 'periods' | 'classes' | 'sections' | 'subjects' | 'rooms';
const grants: Record<SetupKind | 'classSubjects', {view: Permission; manage: Permission}> = {
  rooms: {view: PERMISSIONS.ACADEMIC_ROOMS_VIEW, manage: PERMISSIONS.ACADEMIC_ROOMS_MANAGE},
  classSubjects: {view: PERMISSIONS.ACADEMIC_CLASS_SUBJECTS_VIEW, manage: PERMISSIONS.ACADEMIC_CLASS_SUBJECTS_MANAGE},
  periods: {view: PERMISSIONS.ACADEMIC_PERIODS_VIEW, manage: PERMISSIONS.ACADEMIC_PERIODS_MANAGE},
  classes: {view: PERMISSIONS.ACADEMIC_CLASSES_VIEW, manage: PERMISSIONS.ACADEMIC_CLASSES_MANAGE},
  sections: {view: PERMISSIONS.ACADEMIC_SECTIONS_VIEW, manage: PERMISSIONS.ACADEMIC_SECTIONS_MANAGE},
  subjects: {view: PERMISSIONS.ACADEMIC_SUBJECTS_VIEW, manage: PERMISSIONS.ACADEMIC_SUBJECTS_MANAGE},
};
const models = {rooms: Room, periods: AcademicPeriod, classes: SchoolClass, sections: Section, subjects: Subject};
const missing = () => new RequestContractError(404, 'Academic setup record is unavailable');
const conflict = (message: string) => new RequestContractError(409, message);
const revisionOf = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new RequestContractError(400, 'A positive revision is required');
  return value;
};
const nameOf = (value: unknown, max = 50) => textField(value, 'name', max, 1).replace(/\s+/g, ' ');
const codeOf = (value: unknown) => {
  const code = textField(value, 'code', 20, 1).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(code)) throw new RequestContractError(400, 'Code must use letters, numbers, hyphens or underscores');
  return code;
};
export async function academicSetupScope(identity: JwtPayload | undefined, kind: SetupKind | 'classSubjects', manage: boolean, requested: unknown, session?: ClientSession) {
  const actor = await currentAcademicActor(identity, session);
  if (!['principal', 'super_admin'].includes(actor.role) || !ROLE_PERMISSIONS[actor.role].includes(grants[kind][manage ? 'manage' : 'view']) || (kind === 'periods' && manage && actor.role !== 'super_admin')) {
    throw new RequestContractError(403, 'Academic setup permission is required');
  }
  let branchId: string;
  if (actor.role === 'principal') {
    if (!actor.branchId) throw new RequestContractError(403, 'Principal branch is required');
    branchId = String(actor.branchId);
    if (requested !== undefined && objectIdField(requested, 'branch ID') !== branchId) throw missing();
  } else {
    if (actor.branchId) throw new RequestContractError(403, 'Global Super Admin authority is required');
    branchId = objectIdField(requested, 'target branch ID');
  }
  const branch = await requireAcademicBranch(actor, branchId, session);
  return {actor, branchId, branchName: branch.name};
}
export async function setupBranches(identity: JwtPayload | undefined) {
  const actor = await currentAcademicActor(identity);
  if (!['principal', 'super_admin'].includes(actor.role) || !([PERMISSIONS.ACADEMIC_PERIODS_VIEW, PERMISSIONS.ACADEMIC_ROOMS_VIEW].some(grant => ROLE_PERMISSIONS[actor.role].includes(grant)))) throw new RequestContractError(403, 'Academic setup permission is required');
  if (actor.role === 'super_admin' && actor.branchId) throw new RequestContractError(403, 'Global Super Admin authority is required');
  if (actor.role === 'principal' && !actor.branchId) throw new RequestContractError(403, 'Principal branch is required');
  const rows = await Branch.find({isActive: true, active: {$ne: false}, ...schoolBranchFilter(actor)}).select('_id name code').sort({name: 1}).lean();
  return {items: rows.map(row => ({id: String(row._id), name: row.name, code: row.code}))};
}
const periodDTO = (row: any) => ({id: String(row._id), name: row.name, code: row.code, startDate: row.startDate, endDate: row.endDate, status: row.status, revision: row.revision});
const catalogDTO = (row: any, period?: any) => ({id: String(row._id), name: row.name, ...(row.code ? {code: row.code} : {}), isActive: row.isActive, revision: row.revision ?? 1,
  ...(row.academicYear ? {academicYear: row.academicYear, academicPeriodId: row.academicPeriodId ? String(row.academicPeriodId) : null, periodName: period?.name ?? row.academicYear, periodStatus: period?.status ?? 'legacy', legacy: !row.academicPeriodId} : {}),
  ...(row.category ? {category: row.category} : {}),
  ...(row.classId ? {classId: String(row.classId)} : {}),
});
async function parentClass(branchId: string, id: unknown, session?: ClientSession, writable = false) {
  const row = await SchoolClass.findOne().where('_id').equals(objectIdField(id, 'class ID')).where('branchId').equals(branchId).session(session ?? null).lean();
  if (!row) throw missing();
  if (writable) {
    if (!row.academicPeriodId) throw conflict('Legacy Classes are read-only until an explicit migration is approved');
    if (!row.isActive) throw conflict('The parent Class is inactive');
    await activePeriod(branchId, String(row.academicPeriodId), session);
  }
  return row;
}
async function activePeriod(branchId: string, id: unknown, session?: ClientSession) {
  const period = await AcademicPeriod.findOne({_id: objectIdField(id, 'academic period ID'), branchId}).session(session ?? null).lean();
  if (!period) throw missing();
  if (period.status !== 'active') throw conflict('An active Academic Period is required');
  return period;
}
export async function readSetup(identity: JwtPayload | undefined, kind: SetupKind, query: unknown, id?: unknown) {
  const input = objectBody(query, ['branchId', ...(kind === 'rooms' ? ['q'] : []), ...(kind === 'classes' ? ['academicPeriodId'] : []), ...(kind === 'sections' ? ['classId'] : []), 'offset']);
  const ctx = await academicSetupScope(identity, kind, false, input.branchId);
  const filter: any = {branchId: ctx.branchId};
  if (kind === 'rooms' && input.q !== undefined) {
    if (typeof input.q !== 'string' || input.q.length > 100) throw new RequestContractError(400, 'Invalid Room search');
    const literal = input.q.trim().replace(/[.*+?^$\u007b\u007d()|[\]\\]/g, '\\$&');
    if (literal) filter.$or = [{name: {$regex: literal, $options: 'i'}}, {code: {$regex: literal, $options: 'i'}}];
  }
  if (id !== undefined) filter._id = objectIdField(id, 'record ID');
  if (kind === 'classes' && input.academicPeriodId !== undefined) {
    const periodId = objectIdField(input.academicPeriodId, 'academic period ID');
    if (!await AcademicPeriod.exists({_id: periodId, branchId: ctx.branchId})) throw missing();
    filter.academicPeriodId = periodId;
  }
  if (kind === 'sections') {
    const parent = await parentClass(ctx.branchId, input.classId);
    filter.classId = parent._id;
  }
  const offset = input.offset === undefined ? 0 : Number(input.offset);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new RequestContractError(400, 'Invalid page offset');
  const Model: any = models[kind];
  const rows: any[] = await Model.find(filter).sort(kind === 'periods' ? {startDate: -1, _id: 1} : {name: 1, _id: 1}).skip(id === undefined ? offset : 0).limit(id === undefined ? 50 : 1).lean();
  if (id !== undefined && !rows.length) throw missing();
  const periods = kind === 'classes' ? await AcademicPeriod.find({branchId: ctx.branchId}).lean() : [];
  const items = rows.map(row => kind === 'periods' ? periodDTO(row) : catalogDTO(row, periods.find(p => String(p._id) === String(row.academicPeriodId))));
  if (id !== undefined) return items[0];
  const total = await Model.countDocuments(filter);
  const current = kind === 'periods' ? await AcademicPeriod.findOne({branchId: ctx.branchId, status: 'active'}).lean() : null;
  return {items, total, nextOffset: offset + rows.length < total ? offset + rows.length : null, branchName: ctx.branchName, ...(kind === 'periods' ? {current: current ? periodDTO(current) : null} : {})};
}

// Conservative retention policy: any reference blocks deactivation. This also
// protects historical endpoints that still resolve active catalog objects.
// No cascade, no deletion, and no invented distinction in legacy status data.
const dependencyCollections = ['students', 'teacherassignments', 'timetableperiods', 'attendances', 'attendancesessions', 'syllabuses', 'lessonplans', 'lessondeliveries', 'homeworks', 'quizzes', 'academicresults', 'catchupitems', 'teachernotices', 'assignedworks'];
async function assertUnused(kind: SetupKind, row: any, session: ClientSession) {
  if (kind === 'rooms') {
    for (const name of ['timetableperiods', 'substituteassignments'])
      if (await mongoose.connection.collection(name).findOne({roomId: row._id}, {session, projection: {_id: 1}}))
        throw conflict('This Room is referenced by a timetable or substitution; retain it to protect schedules and history');
    return;
  }
  if ((kind === 'classes' || kind === 'sections') && await StudentEnrollment.exists({[kind === 'classes' ? 'classId' : 'sectionId']: row._id, status: 'active'}).session(session)) throw conflict('This record has active Student Enrollments; move or withdraw Students first');
  if ((kind === 'classes' || kind === 'subjects') && await ClassSubject.exists({[kind === 'classes' ? 'classId' : 'subjectId']: row._id, isActive: true}).session(session)) throw conflict('This record has active Class Subjects; deactivate curriculum availability first');
  if (kind === 'classes' && await Section.exists({classId: row._id}).session(session)) throw conflict('This Class has Sections; retain it while dependent records exist');
  const key = kind === 'classes' ? 'classId' : kind === 'sections' ? 'sectionId' : 'subjectId';
  for (const collection of dependencyCollections) {
    const filter: any = key === 'classId' && collection === 'assignedworks' ? {$or: [{classId: row._id}, {sourceId: row._id}]} : {[key]: row._id};
    if (await mongoose.connection.collection(collection).findOne(filter, {session, projection: {_id: 1}})) throw conflict('This record is referenced by academic operations or history and cannot be deactivated');
  }
}
export async function writeSetup(identity: JwtPayload | undefined, token: SessionAuthority, kind: SetupKind, requestedBranch: unknown, action: 'create' | 'update' | 'deactivate' | 'reactivate' | 'activate' | 'close' | 'archive', id: unknown, body: unknown) {
  const fields = action === 'create' || action === 'update' ? (kind === 'rooms' ? ['name', 'code', 'category'] : kind === 'periods' ? ['name', ...(action === 'create' ? ['code'] : []), 'startDate', 'endDate'] : kind === 'classes' ? ['name', 'code', ...(action === 'create' ? ['academicPeriodId'] : [])] : kind === 'sections' ? ['name', 'code', ...(action === 'create' ? ['classId'] : [])] : ['name']) : [];
  const input = objectBody(body, [...fields, ...(action === 'create' ? [] : ['revision'])]);
  const initial = await academicSetupScope(identity, kind, true, requestedBranch);
  try {
    return await withAcademicCatalogLock(initial.branchId, async session => {
      // Lock current identity and login too: branch/role/session changes cannot
      // slip between authorization and the committed mutation.
      await User.collection.updateOne({_id: initial.actor._id}, {$inc: {__v: 1}}, {session});
      await revalidateAuthenticatedSession(token, {userId: String(initial.actor._id), role: initial.actor.role}, session);
      const ctx = await academicSetupScope(identity, kind, true, requestedBranch, session);
      if (ctx.branchId !== initial.branchId) throw missing();
      const Model: any = models[kind];
      const row: any = action === 'create' ? null : await Model.findOne({_id: objectIdField(id, 'record ID'), branchId: ctx.branchId}).session(session);
      if (action !== 'create' && !row) throw missing();
      if (row && (row.revision ?? 1) !== revisionOf(input.revision)) throw conflict('Record changed; refresh before saving');
      let period: any;
      if (kind === 'classes') {
        if (row && !row.academicPeriodId) throw conflict('Legacy Classes are read-only until an explicit migration is approved');
        period = await activePeriod(ctx.branchId, row ? String(row.academicPeriodId) : input.academicPeriodId, session);
      }
      if (kind === 'sections') await parentClass(ctx.branchId, row ? String(row.classId) : input.classId, session, true);
      if (kind === 'periods' && row && action === 'update' && row.status !== 'draft') throw conflict('Only a draft Academic Period can be edited');
      const category = kind === 'rooms' && (action === 'create' || action === 'update') ? input.category : undefined;
      if (kind === 'rooms' && (action === 'create' || action === 'update') && !ROOM_CATEGORIES.includes(category as typeof ROOM_CATEGORIES[number])) throw new RequestContractError(400, 'Select a valid Room category');
      if (action === 'create') {
        let values: any = {branchId: ctx.branchId, name: nameOf(input.name, kind === 'rooms' ? 80 : kind === 'periods' || kind === 'subjects' ? 100 : 50), revision: 1};
        if (kind === 'rooms') Object.assign(values, {category, createdBy: ctx.actor._id, updatedBy: ctx.actor._id});
        if (kind !== 'subjects') values.code = codeOf(input.code);
        if (kind === 'periods') values = {...values, ...periodDates(input), createdBy: ctx.actor._id, updatedBy: ctx.actor._id};
        if (kind === 'classes') values = {...values, academicPeriodId: period._id, academicYear: period.code};
        if (kind === 'sections') values.classId = objectIdField(input.classId, 'class ID');
        const created = await Model.create([values], {session});
        return kind === 'periods' ? periodDTO(created[0]) : catalogDTO(created[0], period);
      }
      if (action === 'update') {
        row.name = nameOf(input.name, kind === 'rooms' ? 80 : kind === 'periods' || kind === 'subjects' ? 100 : 50);
        if (kind !== 'subjects' && kind !== 'periods') row.code = codeOf(input.code);
        if (kind === 'rooms') row.category = category;
        if (kind === 'periods') Object.assign(row, periodDates(input));
      } else if (kind === 'periods') {
        const target = action === 'activate' ? 'active' : action === 'close' ? 'closed' : action === 'archive' ? 'archived' : '';
        if (!((row.status === 'draft' && ['active', 'archived'].includes(target)) || (row.status === 'active' && target === 'closed') || (row.status === 'closed' && target === 'archived'))) throw conflict('Invalid Academic Period lifecycle transition');
        // Closing/archiving retains the complete catalog and historical data.
        // Only catalog writes are frozen; existing operational reads continue.
        row.status = target;
      } else {
        if (!['deactivate', 'reactivate'].includes(action)) throw new RequestContractError(400, 'Unsupported lifecycle action');
        if (action === 'deactivate') await assertUnused(kind, row, session);
        row.isActive = action === 'reactivate';
      }
      row.revision = (row.revision ?? 1) + 1;
      if (kind === 'periods' || kind === 'rooms') row.updatedBy = ctx.actor._id;
      await row.save({session});
      return kind === 'periods' ? periodDTO(row) : catalogDTO(row, period);
    });
  } catch (error) {
    if ((error as {code?: number}).code === 11000) throw conflict('A duplicate code/name or an active Academic Period already exists in this branch');
    throw error;
  }
}
function periodDates(input: Record<string, unknown>) {
  if (![input.startDate, input.endDate].every(value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))) throw new RequestContractError(400, 'Period dates must use YYYY-MM-DD');
  const start = dateField(input.startDate, 'start date', true), end = dateField(input.endDate, 'end date', true);
  if (start >= end) throw new RequestContractError(400, 'Start date must be before end date');
  return {startDate: input.startDate as string, endDate: input.endDate as string};
}
export async function ensureAcademicSetupIndexes() {
  await ensureEnrollmentIndexes();
  await Promise.all([Room.createIndexes(), AcademicPeriod.createIndexes(), SchoolClass.createIndexes(), Section.createIndexes(), Subject.createIndexes(), ClassSubject.createIndexes()]);
}
