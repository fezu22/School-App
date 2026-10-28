const STAFF_PREFIXES = [
  '/api/teacher', '/api/principal', '/api/admin', '/api/branches',
  '/api/academic-setup', '/api/syllabuses', '/api/timetables',
  '/api/teacher-assignments', '/api/assigned-work', '/api/student',
  '/api/approval-requests', '/api/privileged-requests', '/api/automation',
  '/api/attendance-review',
  '/api/usage', '/api/backup', '/api/health', '/api/sessions',
  '/api/staff-students', '/api/live-lessons',
];
function isStaffPath(url) {
  const pathname = String(url || '').split('?')[0];
  return STAFF_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
async function loadStaffApplication() {
  require('tsx/cjs/api').register();
  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI, {
    dbName: process.env.MONGODB_DB,
    autoIndex: false,
  });
  const imported = require('./staff/src/app.ts');
  return imported.default || imported;
}
module.exports = { isStaffPath, loadStaffApplication };
