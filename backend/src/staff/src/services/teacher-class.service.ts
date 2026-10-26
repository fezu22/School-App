import type {JwtPayload} from './jwt.service';
import {getTeacherScope} from './teacher-scope.service';
import {objectIdField, RequestContractError} from '../utils/request-validation';
import {PERMISSIONS} from '../constants/permissions';
import {ROLE_PERMISSIONS} from '../constants/rolePermissions';

export const classScope = async (identity: JwtPayload | undefined) => {
  // This domain owns its action permission. Assignment scope alone must never
  // imply permission to read a roster, mark attendance or host a future lesson.
  if (!ROLE_PERMISSIONS.teacher.includes(PERMISSIONS.TEACHER_CLASSES_VIEW)) {
    throw new RequestContractError(403, 'Teacher class access is not permitted');
  }
  return getTeacherScope(identity);
};

export const getTeacherClasses = async (identity: JwtPayload | undefined) =>
  (await classScope(identity)).tuples;

// Class detail retains all of this Teacher's tuples under that class; it grants
// no blanket authority over other sections, subjects, students or future domains.
export const getTeacherClass = async (identity: JwtPayload | undefined, requested: {
  classId: unknown; sectionId?: unknown; subjectId?: unknown;
}) => {
  const classId = objectIdField(requested.classId, 'class ID');
  const sectionId = requested.sectionId === undefined ? undefined : objectIdField(requested.sectionId, 'section ID');
  const subjectId = requested.subjectId === undefined ? undefined : objectIdField(requested.subjectId, 'subject ID');
  if ((sectionId === undefined) !== (subjectId === undefined)) {
    throw new RequestContractError(400, 'Section and subject must be requested together');
  }
  const scope = await classScope(identity);
  const tuples = scope.tuples.filter(tuple => tuple.classId === classId &&
    (sectionId === undefined || (tuple.sectionId === sectionId && tuple.subjectId === subjectId)));
  if (!tuples.length) throw new RequestContractError(404, 'Assigned class not found');
  return tuples;
};
