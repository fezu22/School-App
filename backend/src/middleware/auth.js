import jwt from 'jsonwebtoken';
import { User, SchoolClass, Student } from '../models/index.js';
export const route = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
export const problem = (status, message) =>
  Object.assign(new Error(message), { status });
export const auth = route(async (req, _res, next) => {
  let payload;
  try {
    payload = jwt.verify(
      (req.headers.authorization || '').replace(/^Bearer /, ''),
      process.env.JWT_SECRET,
      { algorithms: ['HS256'] },
    );
  } catch {
    throw problem(401, 'Please sign in again');
  }
  const user = await User.findById(payload.sub);
  if (!user || !user.active || user.tokenVersion !== payload.version)
    throw problem(401, 'Account or session is no longer active');
  req.user = user;
  next();
});
export const selectChild = route(async (req, _res, next) => {
  const requested = req.get('x-school-child-id');
  if (!requested) return next();
  if (req.user.role !== 'PARENT')
    return _res
      .status(403)
      .json({ error: 'Child selection is only available to parent accounts' });
  const student = await Student.findOne({
    $and: [{ _id: requested }, { _id: { $in: req.user.studentIds } }],
  });
  if (!student)
    return _res
      .status(403)
      .json({
        error: 'Selected child is no longer linked to this parent',
        code: 'CHILD_NOT_LINKED',
      });
  req.selectedStudentId = student._id;
  next();
});
export const allow =
  (...roles) =>
  (req, _res, next) =>
    roles.includes(req.user.role)
      ? next()
      : next(problem(403, 'Access denied'));
export const contains = (ids, id) =>
  ids.some(value => String(value) === String(id));
export async function classFilter(user, selectedStudentId) {
  if (user.role === 'SUPER_ADMIN') return {};
  if (['PRINCIPAL', 'ACADEMIC_COORDINATOR', 'EXAM_OFFICER'].includes(user.role))
    return { branchId: { $in: user.branchIds } };
  if (user.role === 'TEACHER')
    return { _id: { $in: user.classIds }, branchId: { $in: user.branchIds } };
  if (['STUDENT', 'PARENT'].includes(user.role)) {
    const filter = { _id: { $in: user.studentIds } };
    if (selectedStudentId) filter._id = selectedStudentId;
    const students = await Student.find(filter);
    return { _id: { $in: students.map(s => s.classId) } };
  }
  return { _id: { $in: [] } };
}
export async function getClass(user, id, selectedStudentId) {
  const c = await SchoolClass.findOne({
    $and: [await classFilter(user, selectedStudentId), { _id: id }],
  });
  if (!c) throw problem(403, 'Class not assigned');
  return c;
}
export async function studentFilter(user, selectedStudentId) {
  if (user.role === 'SUPER_ADMIN') return {};
  if (
    [
      'PRINCIPAL',
      'ACCOUNTANT',
      'ACADEMIC_COORDINATOR',
      'EXAM_OFFICER',
    ].includes(user.role)
  )
    return { branchId: { $in: user.branchIds } };
  if (user.role === 'TEACHER')
    return {
      classId: { $in: user.classIds },
      branchId: { $in: user.branchIds },
    };
  const ids = ['STUDENT', 'PARENT'].includes(user.role) ? user.studentIds : [];
  return {
    _id: {
      $in:
        selectedStudentId && user.role === 'PARENT' ? [selectedStudentId] : ids,
    },
  };
}
export async function getStudent(user, id, selectedStudentId) {
  const s = await Student.findOne({
    $and: [await studentFilter(user, selectedStudentId), { _id: id }],
  });
  if (!s) throw problem(403, 'Student not assigned or linked');
  return s;
}
export function branchAllowed(user, id) {
  if (user.role !== 'SUPER_ADMIN' && !contains(user.branchIds, id))
    throw problem(403, 'Branch not assigned');
}
export const publicUser = u => {
  const o = u.toObject();
  delete o.passwordHash;
  delete o.__v;
  return o;
};
