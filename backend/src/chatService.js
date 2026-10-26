const crypto = require('node:crypto');
const { ObjectId } = require('mongodb');
const {
  apiId,
  assertSameBranch,
  referenceFieldFilter,
  referenceFieldQuery,
  referenceValues,
  resolveRecordReference,
  resolveUserForRole,
} = require('./identityReferenceAdapter');

const HISTORY_PAGE_SIZE = 50;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_CHAT_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function validateChatAttachment(file) {
  if (!file || !Buffer.isBuffer(file.buffer))
    return { error: 'Choose a supported image to attach.' };
  if (file.size > MAX_CHAT_ATTACHMENT_BYTES)
    return { error: 'Chat images must be 10 MB or smaller.' };
  const path = require('node:path');
  const extension = path.extname(file.originalname || '').toLowerCase();
  const signatures = {
    '.jpg': { mime: 'image/jpeg', signature: Buffer.from([0xff, 0xd8, 0xff]) },
    '.jpeg': { mime: 'image/jpeg', signature: Buffer.from([0xff, 0xd8, 0xff]) },
    '.png': {
      mime: 'image/png',
      signature: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    },
    '.webp': { mime: 'image/webp', signature: Buffer.from('RIFF') },
  };
  const type = signatures[extension];
  const isWebp = extension === '.webp' &&
    file.buffer.length >= 12 && file.buffer.toString('ascii', 8, 12) === 'WEBP';
  if (
    !type ||
    file.mimetype !== type.mime ||
    file.buffer.length < type.signature.length ||
    !file.buffer.subarray(0, type.signature.length).equals(type.signature) ||
    (extension === '.webp' && !isWebp)
  ) {
    return { error: 'Chat attachments must be valid JPEG, PNG, or WebP images.' };
  }
  const fileName = path.basename(String(file.originalname).replace(/\\/g, '/'))
    .replace(/[\r\n\0"]/g, '_')
    .slice(0, 180);
  return { contentType: type.mime, fileName };
}

function verifiedLinkFilter(parentUserId, studentId) {
  const filter = {
    parentUserId,
    revokedAt: null,
    status: { $ne: 'revoked' },
    $or: [{ status: 'verified' }, { verified: true }],
  };
  if (studentId != null) filter.studentId = studentId;
  return filter;
}

function hasBranchId(value) {
  return value instanceof ObjectId || (typeof value === 'string' && Boolean(value.trim()));
}

function sameBranchId(left, right) {
  return hasBranchId(left) && hasBranchId(right) && String(left).trim() === String(right).trim();
}

async function sameResolvedBranch(db, left, right) {
  try {
    await assertSameBranch(db, left, right);
    return true;
  } catch (error) {
    if (error.code === 'BRANCH_ACCESS_DENIED') return false;
    throw error;
  }
}

async function getStudentForParticipant(db, user, studentId) {
  if (
    !user?.id ||
    !hasBranchId(user.branchId) ||
    !['student', 'parent'].includes(user.role)
  ) return null;
  const requestedId = String(studentId || '').trim();
  if (!requestedId || requestedId.length > 120) return null;

  const identity = await resolveUserForRole(db, user.id, user.role);
  if (!(await sameResolvedBranch(db, user.branchId, identity.branchId))) return null;
  if (user.role === 'student') {
    const students = await db.collection('students')
      .find({ userId: { $in: referenceValues(identity) } })
      .limit(2)
      .toArray();
    if (students.length > 1) {
      const error = new Error('User reference links to multiple student records; resolve the conflicting IDs before access.');
      error.statusCode = 409;
      error.code = 'INTEGRATION_REFERENCE_CONFLICT';
      throw error;
    }
    const student = students[0];
    if (!student) return null;
    const resolvedStudent = await resolveRecordReference(db, 'students', requestedId, { label: 'Student' }).catch(() => null);
    if (!resolvedStudent || String(resolvedStudent._id || apiId(resolvedStudent)) !== String(student._id || apiId(student))) return null;
    if (!(await sameResolvedBranch(db, identity.branchId, student.branchId))) return null;
    return student;
  }

  const link = await db
    .collection('parentChildLinks')
    .findOne({
      ...verifiedLinkFilter(null, null),
      ...referenceFieldFilter('parentUserId', identity),
      $and: [{ $or: referenceFieldQuery('studentId', requestedId).$or }],
    });
  if (!link) return null;
  const student = await resolveRecordReference(db, 'students', link.studentId, { label: 'Student' });
  if (!(await sameResolvedBranch(db, identity.branchId, student.branchId))) return null;
  return student;
}

async function listAssignedTeachers(db, student) {
  if (!student?.classId || !hasBranchId(student.branchId))
    return [];
  let assignments;
  if (process.env.INTEGRATED_STAFF_ENABLED === 'true') {
    if (!ObjectId.isValid(String(student.classId)) || !student.sectionId || !ObjectId.isValid(String(student.sectionId))) return [];
    const now = new Date();
    const rows = await db.collection('teacherassignments').find({classId: new ObjectId(String(student.classId)), sectionId: new ObjectId(String(student.sectionId)), isActive: true, revokedAt: null}).limit(100).toArray();
    assignments = rows.filter(row => row.validFrom instanceof Date && row.validFrom <= now && (!row.validUntil || row.validUntil > now))
      .map(row => ({...row, teacherUserId: row.teacherId}));
  } else {
    assignments = await db.collection('classTeacherAssignments').find({classId: student.classId, active: true, status: 'assigned'}).limit(100).toArray();
  }
  const teachers = [];
  const seen = new Set();
  for (const assignment of assignments) {
    if (!assignment.teacherUserId) continue;
    if (!(await sameResolvedBranch(db, assignment.branchId, student.branchId))) continue;
    const teacher = await resolveUserForRole(db, assignment.teacherUserId, 'teacher');
    if (teacher.active === false || teacher.isActive === false) continue;
    if (!(await sameResolvedBranch(db, teacher.branchId, student.branchId))) continue;
    const id = apiId(teacher);
    if (seen.has(id)) continue;
    seen.add(id);
    teachers.push({
      id: String(id),
      fullName: teacher.fullName || teacher.name || 'Class teacher',
      email: teacher.email || '',
    });
  }
  return teachers;
}

async function canAccessConversation(db, user, conversation) {
  if (
    !conversation ||
    !user?.id ||
    !hasBranchId(user.branchId)
  ) return null;
  const student = await resolveRecordReference(db, 'students', String(conversation.studentId), { label: 'Student' });
  if (!(await sameResolvedBranch(db, user.branchId, student.branchId))) return null;
  if (!(await sameResolvedBranch(db, conversation.branchId, student.branchId))) return null;
  const identity = await resolveUserForRole(db, user.id, user.role);
  if (!(await sameResolvedBranch(db, user.branchId, identity.branchId))) return null;

  if (user.role === 'student') {
    const owner = await resolveUserForRole(db, student.userId, 'student');
    if (String(apiId(owner)) !== String(apiId(identity))) return null;
  } else if (user.role === 'parent') {
    const link = await db
      .collection('parentChildLinks')
      .findOne({
        ...verifiedLinkFilter(null, null),
        ...referenceFieldFilter('parentUserId', identity),
        ...referenceFieldFilter('studentId', student),
      });
    if (!link) return null;
  } else if (user.role !== 'teacher') {
    return null;
  }

  const teachers = await listAssignedTeachers(db, student);
  if (!teachers.some(teacher => teacher.id === String(conversation.teacherUserId)))
    return null;
  if (user.role === 'teacher' && String(apiId(identity)) !== String(conversation.teacherUserId))
    return null;

  return { student, teacher: teachers.find(item => item.id === String(conversation.teacherUserId)) };
}

async function getVerifiedChildren(db, parentIdentity, branchId) {
  if (!parentIdentity || !hasBranchId(branchId)) return [];
  const links = await db
    .collection('parentChildLinks')
    .find({
      ...verifiedLinkFilter(null, null),
      ...referenceFieldFilter('parentUserId', parentIdentity),
      revokedAt: null,
    })
    .toArray();
  const children = new Map();
  for (const link of links) {
    const student = await resolveRecordReference(db, 'students', link.studentId, { label: 'Student' });
    if (await sameResolvedBranch(db, branchId, student.branchId)) {
      children.set(String(apiId(student)), student);
    }
  }
  return [...children.values()];
}

async function listTeacherStudents(db, teacher) {
  if (!teacher?.id || !hasBranchId(teacher.branchId))
    return [];
  const identity = await resolveUserForRole(db, teacher.id, 'teacher');
  if (!(await sameResolvedBranch(db, teacher.branchId, identity.branchId))) return [];
  let assignments;
  if (process.env.INTEGRATED_STAFF_ENABLED === 'true') {
    const now = new Date();
    const rows = await db.collection('teacherassignments').find({teacherId: identity._id, isActive: true, revokedAt: null}).limit(100).toArray();
    assignments = rows.filter(row => row.validFrom instanceof Date && row.validFrom <= now && (!row.validUntil || row.validUntil > now));
  } else {
    assignments = await db.collection('classTeacherAssignments').find({teacherUserId: {$in: referenceValues(identity)}, active: true, status: 'assigned'}).limit(100).toArray();
  }
  const authorizedAssignments = [];
  for (const item of assignments) {
    if (!item.classId) continue;
    if (await sameResolvedBranch(db, item.branchId, teacher.branchId)) authorizedAssignments.push(item);
  }
  const classes = [...new Set(authorizedAssignments.map(item => item.classId))];
  if (!classes.length) return [];
  const students = await db
    .collection('students')
    .find({ classId: { $in: classes } })
    .limit(1000)
    .toArray();
  const allowed = new Set(authorizedAssignments.map(item => String(item.classId)));
  const authorizedStudents = [];
  for (const student of students) {
    if (allowed.has(String(student.classId)) &&
      (process.env.INTEGRATED_STAFF_ENABLED !== 'true' || authorizedAssignments.some(a => String(a.classId) === String(student.classId) && String(a.sectionId) === String(student.sectionId))) &&
      await sameResolvedBranch(db, student.branchId, teacher.branchId)) authorizedStudents.push(student);
  }
  return authorizedStudents;
}

async function authorizedPairs(db, user, requestedStudentId) {
  if (!user?.id || !hasBranchId(user.branchId)) return [];
  const identity = await resolveUserForRole(db, user.id, user.role);
  if (!(await sameResolvedBranch(db, user.branchId, identity.branchId))) return [];
  let students;
  if (user.role === 'student') {
    const ownRecords = await db.collection('students')
      .find({ userId: { $in: referenceValues(identity) } })
      .limit(2)
      .toArray();
    if (ownRecords.length > 1) {
      const error = new Error('User reference links to multiple student records; resolve the conflicting IDs before access.');
      error.statusCode = 409;
      error.code = 'INTEGRATION_REFERENCE_CONFLICT';
      throw error;
    }
    const own = ownRecords[0];
    students = own &&
      await sameResolvedBranch(db, identity.branchId, own.branchId) &&
      (!requestedStudentId || String(apiId(own)) === requestedStudentId)
      ? [own]
      : [];
  } else if (user.role === 'parent') {
    students = await getVerifiedChildren(db, identity, user.branchId);
    if (requestedStudentId) students = students.filter(item => String(apiId(item)) === requestedStudentId);
  } else if (user.role === 'teacher') {
    students = await listTeacherStudents(db, identity);
    if (requestedStudentId)
      students = students.filter(item => String(item.id) === requestedStudentId);
  } else {
    return [];
  }

  const pairs = [];
  for (const student of students) {
    if (!student?.id && !student?._id) continue;
    const teachers = await listAssignedTeachers(db, student);
    for (const teacher of teachers) {
      if (user.role !== 'teacher' || teacher.id === String(apiId(identity))) {
        pairs.push({ student, teacher });
      }
    }
  }
  return pairs;
}

function encodeCursor(document) {
  return Buffer.from(
    JSON.stringify({ createdAt: document.createdAt, id: String(document._id) }),
  ).toString('base64url');
}

function decodeCursor(value) {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const createdAt = new Date(cursor.createdAt);
    if (!ObjectId.isValid(cursor.id) || !Number.isFinite(createdAt.getTime())) return null;
    return { createdAt, id: new ObjectId(cursor.id) };
  } catch {
    return null;
  }
}

function serializeMessage(message, viewerUserId) {
  return {
    id: String(message.id || message._id),
    conversationId: String(message.conversationId),
    senderUserId: String(message.senderUserId),
    senderRole: message.senderRole,
    body: message.body,
    attachments: (message.attachments || []).map(attachment => ({
      id: String(attachment.id),
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      fileSize: attachment.fileSize,
    })),
    createdAt: message.createdAt,
    readByOther: (message.readByUserIds || []).some(
      userId => String(userId) !== String(viewerUserId),
    ),
  };
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = {
  HISTORY_PAGE_SIZE,
  MAX_MESSAGE_LENGTH,
  MAX_CHAT_ATTACHMENT_BYTES,
  validateChatAttachment,
  verifiedLinkFilter,
  getStudentForParticipant,
  listAssignedTeachers,
  canAccessConversation,
  getVerifiedChildren,
  authorizedPairs,
  encodeCursor,
  decodeCursor,
  serializeMessage,
  hashToken,
  sameBranchId,
};
