const crypto = require('node:crypto');
const { getDatabase } = require('./database');

const MAX_TITLE_LENGTH = 120;
const MAX_MESSAGE_LENGTH = 4000;

function validateApplication(input) {
  const title = typeof input?.title === 'string' ? input.title.trim() : '';
  const message =
    typeof input?.message === 'string' ? input.message.trim() : '';
  if (!title || title.length > MAX_TITLE_LENGTH) {
    return {
      error: `title is required and must be at most ${MAX_TITLE_LENGTH} characters.`,
    };
  }
  if (!message || message.length > MAX_MESSAGE_LENGTH) {
    return {
      error: `message is required and must be at most ${MAX_MESSAGE_LENGTH} characters.`,
    };
  }
  return { value: { title, message } };
}

async function resolveAssignedTeacher(classId) {
  const db = getDatabase();
  const assignments = await db
    .collection('classTeacherAssignments')
    .find({ classId, active: true, status: 'assigned' })
    .limit(2)
    .toArray();
  if (assignments.length !== 1 || !assignments[0].teacherUserId) return null;
  const teacher = await db.collection('users').findOne({
    id: assignments[0].teacherUserId,
    role: 'teacher',
    active: { $ne: false },
  });
  return teacher?.id || null;
}

async function createClassTeacherApplication({
  input,
  applicant,
  student,
  applicantRole,
}) {
  const validation = validateApplication(input);
  if (validation.error) return { error: validation.error, statusCode: 400 };
  if (!student?.id || !student.classId) {
    return { error: 'The student has no assigned class.', statusCode: 409 };
  }

  const assignedTeacherUserId = await resolveAssignedTeacher(student.classId);
  if (!assignedTeacherUserId) {
    return {
      error:
        'No unique active class teacher assignment is available for this class.',
      statusCode: 409,
    };
  }

  const now = new Date();
  const application = {
    id: crypto.randomUUID(),
    title: validation.value.title,
    message: validation.value.message,
    status: 'submitted',
    classId: student.classId,
    studentId: student.id,
    applicantUserId: applicant.id,
    applicantRole,
    assignedTeacherUserId,
    createdAt: now,
    updatedAt: now,
    statusHistory: [
      {
        status: 'submitted',
        changedAt: now,
        changedByUserId: applicant.id,
        changedByRole: applicantRole,
        note: 'Application submitted to the assigned class teacher.',
      },
    ],
  };
  const result = await getDatabase()
    .collection('classTeacherApplications')
    .insertOne(application);
  return {
    data: { ...application, _id: result.insertedId },
    statusCode: 201,
  };
}

module.exports = {
  validateApplication,
  resolveAssignedTeacher,
  createClassTeacherApplication,
};
