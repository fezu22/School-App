const crypto = require('node:crypto');
const express = require('express');
const { getDatabase } = require('./database');
const { createRecipientNotification } = require('./notificationService');
const {
  combineTenantFilter,
  recordMatchesBranchScope,
  recordMatchesSchoolScope,
  resolveVerifiedTenantScope,
} = require('./schoolAccess');

const router = express.Router();
const decisions = new Set(['approved', 'rejected', 'needs_information']);

async function resolveActorTenantScope(req, { requireBranch = false } = {}) {
  const actor = req.authenticatedUserRecord || req.user;
  return resolveVerifiedTenantScope(getDatabase(), actor, { requireBranch });
}

function requireAssignedTeacher(req, res, next) {
  if (req.user?.role !== 'teacher' || !req.user?.id) {
    return res.status(403).json({ success: false, error: 'Assigned teacher access is required.' });
  }
  return next();
}

// Principal -> Super Admin Applications Routing
router.get('/super-admin', async (req, res, next) => {
  try {
    if (!req.user?.id || !['principal', 'super_admin'].includes(req.user?.role)) {
      return res.status(403).json({
        success: false,
        error: 'Principal or Super Admin authority is required.',
      });
    }
    const tenantScope = await resolveActorTenantScope(req, {
      requireBranch: req.user.role === 'principal',
    });
    const filter = combineTenantFilter(
      tenantScope,
      req.user.role === 'principal' ? { principalUserId: String(req.user.id) } : {},
      { includeBranch: req.user.role === 'principal' },
    );
    const items = await getDatabase()
      .collection('superAdminApplications')
      .find(filter)
      .sort({ updatedAt: -1 })
      .limit(100)
      .toArray();
    return res.json({ success: true, data: items });
  } catch (error) {
    return next(error);
  }
});

router.post('/super-admin', async (req, res, next) => {
  try {
    if (req.user?.role !== 'principal' || !req.user?.id) {
      return res.status(403).json({
        success: false,
        error: 'Only Principals may submit applications routed to the Super Admin.',
      });
    }
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const category = typeof req.body?.category === 'string' ? req.body.category.trim() : 'campus_escalation';
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!title || title.length > 140) {
      return res.status(400).json({ success: false, error: 'Application title must be 1-140 characters.' });
    }
    if (!message || message.length > 2500) {
      return res.status(400).json({ success: false, error: 'Application message must be 1-2,500 characters.' });
    }
    const actor = req.authenticatedUserRecord || req.user;
    if (!actor?.branchId) {
      return res.status(403).json({ success: false, error: 'Principal branch assignment is required.' });
    }
    const tenantScope = await resolveActorTenantScope(req, { requireBranch: true });
    const now = new Date();
    const record = {
      id: crypto.randomUUID(),
      ...(tenantScope.schoolIdHex ? { schoolId: tenantScope.schoolIdHex } : {}),
      branchId: String(tenantScope.branchId || actor.branchId),
      principalUserId: String(req.user.id),
      principalName: actor.fullName || actor.name || 'Principal',
      routedToRole: 'super_admin',
      category,
      title,
      message,
      status: 'submitted',
      statusHistory: [
        {
          status: 'submitted',
          changedAt: now,
          changedByUserId: String(req.user.id),
          changedByRole: 'principal',
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    await getDatabase().collection('superAdminApplications').insertOne(record);
    return res.status(201).json({ success: true, data: record });
  } catch (error) {
    return next(error);
  }
});

router.post('/super-admin/:applicationId/review', async (req, res, next) => {
  try {
    if (req.user?.role !== 'super_admin' || !req.user?.id) {
      return res.status(403).json({
        success: false,
        error: 'Super Admin authority is required to review Principal applications.',
      });
    }
    const { status, note = '' } = req.body || {};
    if (!decisions.has(status)) {
      return res.status(400).json({
        success: false,
        error: 'Choose approved, rejected, or needs_information.',
      });
    }
    if (typeof note !== 'string' || note.trim().length > 1000) {
      return res.status(400).json({
        success: false,
        error: 'Review note must be at most 1,000 characters.',
      });
    }
    const tenantScope = await resolveActorTenantScope(req, { requireBranch: false });
    const db = getDatabase();
    const lookup = combineTenantFilter(
      tenantScope,
      { id: req.params.applicationId },
      { includeBranch: false },
    );
    const application = await db.collection('superAdminApplications').findOne(lookup);
    if (!application) {
      return res.status(404).json({
        success: false,
        error: 'Principal application was not found in your school.',
      });
    }
    const changedAt = new Date();
    const historyEntry = {
      status,
      changedAt,
      changedByUserId: String(req.user.id),
      changedByRole: 'super_admin',
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    await db.collection('superAdminApplications').updateOne(
      combineTenantFilter(tenantScope, { id: application.id }, { includeBranch: false }),
      {
        $set: { status, updatedAt: changedAt },
        $push: { statusHistory: historyEntry },
      },
    );
    const updated = await db.collection('superAdminApplications').findOne(
      combineTenantFilter(tenantScope, { id: application.id }, { includeBranch: false }),
    );
    try {
      await createRecipientNotification({
        ...(tenantScope.schoolIdHex ? { schoolId: tenantScope.schoolIdHex } : {}),
        ...(application.branchId ? { branchId: String(application.branchId) } : {}),
        recipientUserId: application.principalUserId,
        recipientRole: 'principal',
        title: 'Super Admin reviewed your application',
        body: `Your application “${application.title}” is now ${status.replace(/_/g, ' ')}.${note.trim() ? ` ${note.trim()}` : ''}`,
        targetType: 'super_admin_application',
        targetId: application.id,
        recordSnapshot: {
          id: application.id,
          title: application.title,
          status,
          branchId: application.branchId,
          changedAt,
        },
      });
    } catch {
      // Non-fatal if recipient notification record cannot be delivered in isolated mock
    }
    return res.json({ success: true, data: updated });
  } catch (error) {
    return next(error);
  }
});

// Teacher -> Principal Applications Routing
router.get('/principal', async (req, res, next) => {
  try {
    if (!req.user?.id || !['teacher', 'principal'].includes(req.user?.role)) {
      return res.status(403).json({
        success: false,
        error: 'Teacher or Principal authority is required.',
      });
    }
    const actor = req.authenticatedUserRecord || req.user;
    if (req.user.role === 'principal' && !actor?.branchId) {
      return res.status(403).json({ success: false, error: 'Principal branch context is required.' });
    }
    const tenantScope = await resolveActorTenantScope(req, {
      requireBranch: req.user.role === 'principal' || Boolean(actor?.branchId),
    });
    const filter = combineTenantFilter(
      tenantScope,
      req.user.role === 'teacher' ? { teacherUserId: String(req.user.id) } : {},
      { includeBranch: Boolean(tenantScope.branchId) },
    );
    const items = await getDatabase()
      .collection('principalApplications')
      .find(filter)
      .sort({ updatedAt: -1 })
      .limit(100)
      .toArray();
    return res.json({ success: true, data: items });
  } catch (error) {
    return next(error);
  }
});

router.post('/principal', async (req, res, next) => {
  try {
    if (req.user?.role !== 'teacher' || !req.user?.id) {
      return res.status(403).json({
        success: false,
        error: 'Only Teachers may submit applications routed to the Principal.',
      });
    }
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const category = typeof req.body?.category === 'string' ? req.body.category.trim() : 'leave_request';
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!title || title.length > 140) {
      return res.status(400).json({ success: false, error: 'Application title must be 1-140 characters.' });
    }
    if (!message || message.length > 2500) {
      return res.status(400).json({ success: false, error: 'Application message must be 1-2,500 characters.' });
    }
    const actor = req.authenticatedUserRecord || req.user;
    if (!actor?.branchId) {
      return res.status(403).json({ success: false, error: 'Teacher branch assignment is required.' });
    }
    const tenantScope = await resolveActorTenantScope(req, { requireBranch: true });
    const now = new Date();
    const record = {
      id: crypto.randomUUID(),
      ...(tenantScope.schoolIdHex ? { schoolId: tenantScope.schoolIdHex } : {}),
      branchId: String(tenantScope.branchId || actor.branchId),
      teacherUserId: String(req.user.id),
      teacherName: actor.fullName || actor.name || 'Teacher',
      routedToRole: 'principal',
      category,
      title,
      message,
      status: 'submitted',
      statusHistory: [
        {
          status: 'submitted',
          changedAt: now,
          changedByUserId: String(req.user.id),
          changedByRole: 'teacher',
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    await getDatabase().collection('principalApplications').insertOne(record);
    return res.status(201).json({ success: true, data: record });
  } catch (error) {
    return next(error);
  }
});

router.post('/principal/:applicationId/review', async (req, res, next) => {
  try {
    if (req.user?.role !== 'principal' || !req.user?.id) {
      return res.status(403).json({
        success: false,
        error: 'Principal authority is required to review Teacher applications.',
      });
    }
    const { status, note = '' } = req.body || {};
    if (!decisions.has(status)) {
      return res.status(400).json({
        success: false,
        error: 'Choose approved, rejected, or needs_information.',
      });
    }
    if (typeof note !== 'string' || note.trim().length > 1000) {
      return res.status(400).json({
        success: false,
        error: 'Review note must be at most 1,000 characters.',
      });
    }
    const actor = req.authenticatedUserRecord || req.user;
    if (!actor?.branchId) {
      return res.status(403).json({ success: false, error: 'Principal branch context is required.' });
    }
    const tenantScope = await resolveActorTenantScope(req, { requireBranch: true });
    const db = getDatabase();
    const lookup = combineTenantFilter(tenantScope, { id: req.params.applicationId });
    const application = await db.collection('principalApplications').findOne(lookup);
    if (!application) {
      return res.status(404).json({
        success: false,
        error: 'Teacher application was not found in your branch.',
      });
    }
    const changedAt = new Date();
    const historyEntry = {
      status,
      changedAt,
      changedByUserId: String(req.user.id),
      changedByRole: 'principal',
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    await db.collection('principalApplications').updateOne(
      combineTenantFilter(tenantScope, { id: application.id }),
      {
        $set: { status, updatedAt: changedAt },
        $push: { statusHistory: historyEntry },
      },
    );
    const updated = await db.collection('principalApplications').findOne(
      combineTenantFilter(tenantScope, { id: application.id }),
    );
    try {
      await createRecipientNotification({
        ...(tenantScope.schoolIdHex ? { schoolId: tenantScope.schoolIdHex } : {}),
        ...(application.branchId ? { branchId: String(application.branchId) } : {}),
        recipientUserId: application.teacherUserId,
        recipientRole: 'teacher',
        title: 'Principal reviewed your application',
        body: `Your application “${application.title}” is now ${status.replace(/_/g, ' ')}.${note.trim() ? ` ${note.trim()}` : ''}`,
        targetType: 'principal_application',
        targetId: application.id,
        recordSnapshot: {
          id: application.id,
          title: application.title,
          status,
          branchId: application.branchId,
          changedAt,
        },
      });
    } catch {
      // Non-fatal if recipient notification record cannot be delivered in isolated mock
    }
    return res.json({ success: true, data: updated });
  } catch (error) {
    return next(error);
  }
});

router.use(requireAssignedTeacher);

router.get('/', async (req, res, next) => {
  try {
    const actor = req.authenticatedUserRecord || req.user;
    const tenantScope = await resolveActorTenantScope(req, {
      requireBranch: Boolean(actor?.branchId),
    });
    const filter = combineTenantFilter(
      tenantScope,
      { assignedTeacherUserId: req.user.id },
      { includeBranch: Boolean(tenantScope.branchId) },
    );
    const data = await getDatabase()
      .collection('classTeacherApplications')
      .find(filter)
      .project({ applicantUserId: 0, assignedTeacherUserId: 0 })
      .sort({ updatedAt: -1 })
      .limit(100)
      .toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
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
    const actor = req.authenticatedUserRecord || req.user;
    const tenantScope = await resolveActorTenantScope(req, {
      requireBranch: Boolean(actor?.branchId),
    });
    const lookup = combineTenantFilter(
      tenantScope,
      {
        id: req.params.applicationId,
        assignedTeacherUserId: req.user.id,
        status: { $in: ['submitted', 'needs_information'] },
      },
      { includeBranch: Boolean(tenantScope.branchId) },
    );

    const application = await db.collection('classTeacherApplications').findOne(lookup);
    if (!application) {
      return res.status(404).json({ success: false, error: 'Reviewable assigned application was not found.' });
    }

    const applicant = await db.collection('users').findOne(
      combineTenantFilter(
        tenantScope,
        {
          id: application.applicantUserId,
          role: application.applicantRole,
          active: { $ne: false },
        },
        { includeBranch: Boolean(tenantScope.branchId && application.branchId) },
      ),
    );
    if (
      !applicant ||
      !['student', 'parent'].includes(application.applicantRole) ||
      !recordMatchesSchoolScope(applicant, tenantScope) ||
      (tenantScope.branchId && applicant.branchId && !recordMatchesBranchScope(applicant, tenantScope))
    ) {
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
      combineTenantFilter(
        tenantScope,
        { _id: application._id, assignedTeacherUserId: req.user.id, status: application.status },
        { includeBranch: Boolean(tenantScope.branchId) },
      ),
      { $set: { status, updatedAt: changedAt }, $push: { statusHistory: historyEntry } },
    );
    if (!updated.modifiedCount) {
      return res.status(409).json({ success: false, error: 'Application status changed. Refresh and review again.' });
    }

    const reviewed = await db.collection('classTeacherApplications').findOne({ _id: application._id });
    let notificationSent = true;
    try {
      await createRecipientNotification({
        ...(tenantScope.schoolIdHex ? { schoolId: tenantScope.schoolIdHex } : {}),
        ...(application.branchId ? { branchId: String(application.branchId) } : {}),
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
    return res.json({
      success: true,
      data: {
        ...safeData,
        ...(notificationSent ? {} : { notificationWarning: 'Status was saved, but the applicant notification could not be delivered.' }),
      },
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
