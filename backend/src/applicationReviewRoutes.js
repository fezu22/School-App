const express = require('express');
const { getDatabase } = require('./database');
const { createRecipientNotification } = require('./notificationService');

const router = express.Router();
const decisions = new Set(['approved', 'rejected', 'needs_information']);

function requireAssignedTeacher(req, res, next) {
  if (req.user?.role !== 'teacher' || !req.user?.id) {
    return res.status(403).json({ success: false, error: 'Assigned teacher access is required.' });
  }
  return next();
}

router.use(requireAssignedTeacher);

router.get('/', async (req, res, next) => {
  try {
    const data = await getDatabase().collection('classTeacherApplications')
      .find({ assignedTeacherUserId: req.user.id })
      .project({ applicantUserId: 0, assignedTeacherUserId: 0 })
      .sort({ updatedAt: -1 })
      .limit(100)
      .toArray();
    return res.json({ success: true, data });
  } catch (error) { return next(error); }
});

router.post('/:applicationId/review', async (req, res, next) => {
  try {
    const { status, note = '' } = req.body || {};
    if (!decisions.has(status)) {
      return res.status(400).json({ success: false, error: 'Choose approved, rejected, or needs_information.' });
    }
    if (typeof note !== 'string' || note.trim().length > 1000) {
      return res.status(400).json({ success: false, error: 'Review note must be at most 1,000 characters.' });
    }
    const db = getDatabase();
    const application = await db.collection('classTeacherApplications').findOne({
      id: req.params.applicationId,
      assignedTeacherUserId: req.user.id,
      status: { $in: ['submitted', 'needs_information'] },
    });
    if (!application) {
      return res.status(404).json({ success: false, error: 'Reviewable assigned application was not found.' });
    }
    const applicant = await db.collection('users').findOne({
      id: application.applicantUserId,
      role: application.applicantRole,
      active: { $ne: false },
    });
    if (!applicant || !['student', 'parent'].includes(application.applicantRole)) {
      return res.status(409).json({ success: false, error: 'Application recipient is unavailable.' });
    }
    const changedAt = new Date();
    const historyEntry = {
      status,
      changedAt,
      changedByUserId: req.user.id,
      changedByRole: 'teacher',
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    const updated = await db.collection('classTeacherApplications').updateOne(
      { _id: application._id, assignedTeacherUserId: req.user.id, status: application.status },
      { $set: { status, updatedAt: changedAt }, $push: { statusHistory: historyEntry } },
    );
    if (!updated.modifiedCount) {
      return res.status(409).json({ success: false, error: 'Application status changed. Refresh and review again.' });
    }
    const reviewed = await db.collection('classTeacherApplications').findOne({ _id: application._id });
    let notificationSent = true;
    try {
      await createRecipientNotification({
        recipientUserId: applicant.id,
        recipientRole: application.applicantRole,
        title: 'Application status updated',
        body: `Your application “${application.title}” is now ${status.replace(/_/g, ' ')}.${note.trim() ? ` ${note.trim()}` : ''}`,
        targetType: 'class_teacher_application',
        targetId: application.id,
        recordSnapshot: { id: application.id, title: application.title, status, studentId: application.studentId, changedAt },
      });
    } catch (notificationError) {
      notificationSent = false;
      console.error(`Application status saved but notification failed (${notificationError.name}).`);
    }
    const { applicantUserId, assignedTeacherUserId, ...safeData } = reviewed;
    return res.json({ success: true, data: { ...safeData, ...(notificationSent ? {} : { notificationWarning: 'Status was saved, but the applicant notification could not be delivered.' }) } });
  } catch (error) { return next(error); }
});

module.exports = router;
