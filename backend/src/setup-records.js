const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { connectDatabase, closeDatabase, getDatabase } = require('./database');

function arg(name) { const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : ''; }
function required(name) { const value = arg(name).trim(); if (!value) throw new Error(`Missing --${name}.`); return value; }

async function main() {
  const role = required('role').toLowerCase(); const userId = required('user-id');
  if (!['student', 'parent', 'finance'].includes(role)) throw new Error('--role must be student, parent, or finance.');
  await connectDatabase(); const db = getDatabase(); const user = await db.collection('users').findOne({ id: userId, role, active: { $ne: false } });
  if (!user) throw new Error('The supplied user ID does not match an active user with that server-controlled role.');
  if (role === 'student') {
    const studentId = required('student-id'); const fullName = required('full-name'); const grade = required('grade'); const section = required('section');
    if (await db.collection('students').findOne({ $or: [{ userId }, { id: studentId }] })) throw new Error('A student profile already exists for this user or student ID.');
    await db.collection('students').insertOne({ id: studentId, userId, name: fullName, fullName, grade, section, ...(arg('class-id') ? { classId: arg('class-id').trim() } : {}), ...(arg('branch-id') ? { branchId: arg('branch-id').trim() } : {}), status: 'Active', createdAt: new Date() });
    console.log(`Created student profile ${studentId} for user ${userId}.`);
  } else if (role === 'parent') {
    const studentId = required('student-id'); const student = await db.collection('students').findOne({ id: studentId });
    if (!student) throw new Error('The supplied student ID does not reference an existing student profile.');
    if (await db.collection('parentChildLinks').findOne({ parentUserId: userId, studentId, revokedAt: null, $or: [{ status: 'verified' }, { verified: true }] })) throw new Error('The verified parent-child link already exists.');
    const parent = await db.collection('parents').findOne({ userId });
    if (parent) await db.collection('parents').updateOne({ _id: parent._id }, { $addToSet: { studentIds: studentId }, $set: { updatedAt: new Date() } });
    else await db.collection('parents').insertOne({ id: userId, userId, fullName: user.fullName || user.name || '', studentIds: [studentId], createdAt: new Date() });
    await db.collection('parentChildLinks').insertOne({ parentUserId: userId, studentId, status: 'verified', verified: true, revokedAt: null, createdAt: new Date() });
    console.log(`Created parent profile and verified link for user ${userId} to student ${studentId}.`);
  } else {
    const branchId = required('branch-id');
    if (user.branchId && String(user.branchId) !== branchId) throw new Error('This Finance user is already associated with a different branch.');
    await db.collection('users').updateOne({ _id: user._id, id: userId, role: 'finance' }, { $set: { branchId, updatedAt: new Date() } });
    console.log(`Associated Finance user ${userId} with branch ${branchId}.`);
  }
  await closeDatabase();
}
main().catch(async error => { console.error(error.message); await closeDatabase(); process.exitCode = 1; });
