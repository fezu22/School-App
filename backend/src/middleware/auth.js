import jwt from "jsonwebtoken";
import { User, SchoolClass, Student } from "../models/index.js";
export const route = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
export const problem = (status, message) =>
  Object.assign(new Error(message), { status });
export const auth = route(async (req, _res, next) => {
  let payload;
  try {
    payload = jwt.verify(
      (req.headers.authorization || "").replace(/^Bearer /, ""),
      process.env.JWT_SECRET,
      { algorithms: ["HS256"] }
    );
  } catch {
    throw problem(401, "Please sign in again");
  }
  const user = await User.findById(payload.sub);
  if (!user || !user.active || user.tokenVersion !== payload.version)
    throw problem(401, "Account or session is no longer active");
  req.user = user;
  next();
});
export const allow =
  (...roles) =>
  (req, _res, next) =>
    roles.includes(req.user.role)
      ? next()
      : next(problem(403, "Access denied"));
export const contains = (ids, id) =>
  ids.some((value) => String(value) === String(id));
export async function classFilter(user) {
  if (user.role === "SUPER_ADMIN") return {};
  if (["PRINCIPAL", "ACADEMIC_COORDINATOR", "EXAM_OFFICER"].includes(user.role))
    return { branchId: { $in: user.branchIds } };
  if (user.role === "TEACHER")
    return { _id: { $in: user.classIds }, branchId: { $in: user.branchIds } };
  if (["STUDENT", "PARENT"].includes(user.role)) {
    const students = await Student.find({ _id: { $in: user.studentIds } });
    return { _id: { $in: students.map((s) => s.classId) } };
  }
  return { _id: { $in: [] } };
}
export async function getClass(user, id) {
  const c = await SchoolClass.findOne({
    $and: [await classFilter(user), { _id: id }],
  });
  if (!c) throw problem(403, "Class not assigned");
  return c;
}
export async function studentFilter(user) {
  if (user.role === "SUPER_ADMIN") return {};
  if (
    [
      "PRINCIPAL",
      "ACCOUNTANT",
      "ACADEMIC_COORDINATOR",
      "EXAM_OFFICER",
    ].includes(user.role)
  )
    return { branchId: { $in: user.branchIds } };
  if (user.role === "TEACHER")
    return {
      classId: { $in: user.classIds },
      branchId: { $in: user.branchIds },
    };
  return {
    _id: {
      $in: ["STUDENT", "PARENT"].includes(user.role) ? user.studentIds : [],
    },
  };
}
export async function getStudent(user, id) {
  const s = await Student.findOne({
    $and: [await studentFilter(user), { _id: id }],
  });
  if (!s) throw problem(403, "Student not assigned or linked");
  return s;
}
export function branchAllowed(user, id) {
  if (user.role !== "SUPER_ADMIN" && !contains(user.branchIds, id))
    throw problem(403, "Branch not assigned");
}
export const publicUser = (u) => {
  const o = u.toObject();
  delete o.passwordHash;
  delete o.__v;
  return o;
};
