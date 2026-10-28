const crypto = require('node:crypto');
const express = require('express');
const { ObjectId } = require('mongodb');
const { getDatabase } = require('./database');
const { verifiedSchoolDatabase } = require('./schoolAccess');

const STAFF_ROLES = new Set(['teacher', 'principal', 'super_admin']);
const COMPLETION_STATUSES = new Set([
  'planned',
  'completed',
  'partially_completed',
  'rescheduled',
]);

function httpError(message, statusCode = 400, code = undefined) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.code = code;
  return err;
}

function cleanText(value, label, maxLen = 2000, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLen) {
    throw httpError(`${label} must be 1-${maxLen} characters.`);
  }
  return value.trim();
}

function buildIdCandidates(rawId) {
  const str = String(rawId || '').trim();
  if (!str) return [];
  const candidates = [{ id: str }, { _id: str }];
  if (ObjectId.isValid(str)) {
    candidates.push({ _id: new ObjectId(str) });
  }
  return candidates;
}

async function resolvePersistedStaffUser(db, reqUser, fallbackActor) {
  const userId = String(reqUser?.id || fallbackActor?.id || fallbackActor?._id || '').trim();
  if (!userId) {
    throw httpError('Authentication is required.', 401);
  }
  const idChecks = buildIdCandidates(userId);
  const persisted = await db.collection('users').findOne({
    $or: idChecks,
  });
  if (!persisted) {
    throw httpError('Persisted active user account is required for DLP access.', 403);
  }
  if (persisted.active === false || persisted.isActive === false || persisted.status === 'suspended') {
    throw httpError('User account is inactive or suspended.', 403);
  }
  if (persisted.role !== reqUser.role) {
    throw httpError('User role authorization has changed.', 403);
  }
  return persisted;
}

async function verifyBranchInSchool(scopedDb, branchId) {
  if (!branchId) {
    throw httpError('Branch assignment is required for campus DLP operations.', 403);
  }
  const candidates = buildIdCandidates(branchId);
  const branch = await scopedDb.collection('branches').findOne({
    $or: candidates,
  });
  if (!branch || branch.active === false || branch.isActive === false) {
    throw httpError('Active branch assignment in the same school is required.', 403);
  }
  return branch;
}

async function resolveDlpScope(req, database) {
  if (!req.user?.id || !req.user?.role) {
    throw httpError('Authentication is required.', 401);
  }
  if (!STAFF_ROLES.has(req.user.role)) {
    throw httpError('Staff DLP directory access is restricted to academic staff.', 403);
  }
  const db = database();
  const persistedUser = await resolvePersistedStaffUser(
    db,
    req.user,
    req.authenticatedUserRecord,
  );
  if (!persistedUser.schoolId) {
    throw httpError('The account needs a verified school mapping before accessing DLP records.', 503);
  }
  const scopedDb = await verifiedSchoolDatabase(db, persistedUser);
  const branchId = persistedUser.branchId ? String(persistedUser.branchId) : null;
  if (req.user.role !== 'super_admin') {
    if (!branchId) {
      throw httpError('Branch assignment is required for campus DLP operations.', 403);
    }
    await verifyBranchInSchool(scopedDb, branchId);
  } else if (branchId) {
    await verifyBranchInSchool(scopedDb, branchId);
  }
  const canonicalUserId = String(persistedUser.id || persistedUser._id);
  return {
    db,
    scopedDb,
    actor: persistedUser,
    userId: canonicalUserId,
    actorIds: new Set(
      [
        String(req.user.id),
        String(persistedUser.id || ''),
        String(persistedUser._id || ''),
      ].filter(Boolean),
    ),
    role: persistedUser.role,
    schoolId: String(persistedUser.schoolId),
    branchId,
  };
}

function isAssignmentCurrentAndValid(assignment, now = new Date()) {
  if (!assignment || typeof assignment !== 'object') return false;
  if (assignment.isActive === false || assignment.active === false) return false;
  if (assignment.status === 'revoked' || assignment.status === 'inactive') return false;
  if (assignment.revokedAt !== undefined && assignment.revokedAt !== null) return false;

  const startRaw = assignment.validFrom ?? assignment.startsAt ?? assignment.effectiveFrom;
  if (startRaw !== undefined && startRaw !== null) {
    const startDate = new Date(startRaw);
    if (Number.isNaN(startDate.getTime()) || startDate.getTime() > now.getTime()) {
      return false;
    }
  }

  const endRaw = assignment.validUntil ?? assignment.endsAt ?? assignment.effectiveTo;
  if (endRaw !== undefined && endRaw !== null) {
    const endDate = new Date(endRaw);
    if (Number.isNaN(endDate.getTime()) || endDate.getTime() < now.getTime()) {
      return false;
    }
  }

  return true;
}

async function loadTeacherAssignments(scopedDb, scope) {
  const [lowerRows, camelRows] = await Promise.all([
    scopedDb.collection('teacherassignments').find({}).limit(500).toArray(),
    scopedDb.collection('teacherAssignments').find({}).limit(500).toArray(),
  ]);
  const allRows = [...lowerRows, ...camelRows];
  return allRows.filter(a => {
    const teacherRef = String(a.teacherId ?? a.teacherUserId ?? '');
    return scope.actorIds.has(teacherRef);
  });
}

async function verifyClassAndSectionCatalog(scopedDb, branchId, classId, section) {
  if (!classId || typeof classId !== 'string' || !classId.trim()) {
    throw httpError('Class ID is required.', 400);
  }
  if (!section || typeof section !== 'string' || !section.trim()) {
    throw httpError('Section is required and cannot be defaulted.', 400);
  }
  const cleanClassId = classId.trim();
  const cleanSection = section.trim();

  // Check if schoolclasses / schoolClasses catalog is populated in this school
  const [classesLower, classesCamel] = await Promise.all([
    scopedDb.collection('schoolclasses').find({}).limit(200).toArray(),
    scopedDb.collection('schoolClasses').find({}).limit(200).toArray(),
  ]);
  const allClasses = [...classesLower, ...classesCamel];
  if (allClasses.length > 0) {
    const matchedClass = allClasses.find(
      c =>
        c.isActive !== false &&
        c.active !== false &&
        String(c.branchId) === String(branchId) &&
        (String(c._id) === cleanClassId ||
          String(c.id) === cleanClassId ||
          String(c.name) === cleanClassId ||
          String(c.code) === cleanClassId),
    );
    if (!matchedClass) {
      throw httpError('Class does not exist in the specified school and branch.', 403);
    }
  }

  const [sectionsRows] = await Promise.all([
    scopedDb.collection('sections').find({}).limit(200).toArray(),
  ]);
  if (sectionsRows.length > 0) {
    const matchedSection = sectionsRows.find(
      s =>
        s.isActive !== false &&
        s.active !== false &&
        String(s.branchId) === String(branchId) &&
        (String(s._id) === cleanSection ||
          String(s.id) === cleanSection ||
          String(s.name) === cleanSection ||
          String(s.code) === cleanSection),
    );
    if (!matchedSection) {
      throw httpError('Section does not exist in the specified school and branch.', 403);
    }
  }

  return { classId: cleanClassId, section: cleanSection };
}

async function assertTeacherClassAccess(scopedDb, scope, classId, section, now = new Date()) {
  if (!classId || typeof classId !== 'string' || !classId.trim()) {
    throw httpError('Class ID is required.', 400);
  }
  if (!section || typeof section !== 'string' || !section.trim()) {
    throw httpError('Section is required and cannot be defaulted.', 400);
  }
  const targetClass = classId.trim();
  const targetSection = section.trim();

  await verifyClassAndSectionCatalog(scopedDb, scope.branchId, targetClass, targetSection);

  if (scope.role !== 'teacher') {
    return null;
  }

  const teacherAssignments = await loadTeacherAssignments(scopedDb, scope);
  if (teacherAssignments.length === 0) {
    throw httpError('Teacher has no assignments and cannot access or modify DLP records.', 403);
  }

  const matchingAssignment = teacherAssignments.find(a => {
    if (String(a.branchId) !== String(scope.branchId)) return false;
    if (!isAssignmentCurrentAndValid(a, now)) return false;

    const assignedClass = String(a.classId ?? a.className ?? '').trim();
    const assignedSection = String(a.sectionId ?? a.section ?? a.sectionName ?? '').trim();
    if (!assignedClass || !assignedSection) return false;

    return assignedClass === targetClass && assignedSection === targetSection;
  });

  if (!matchingAssignment) {
    throw httpError(
      'Teacher does not hold a current, active, non-revoked assignment for this school, branch, class, and section.',
      403,
    );
  }

  return matchingAssignment;
}

async function verifyAssignmentStillActive(scopedDb, scope, assignment, classId, section) {
  // Re-verify persisted user account is still active
  const persisted = await resolvePersistedStaffUser(scope.db, { id: scope.userId, role: scope.role }, scope.actor);
  if (String(persisted.schoolId) !== String(scope.schoolId) || String(persisted.branchId || '') !== String(scope.branchId || '')) {
    throw httpError('Staff school or branch assignment changed during operation.', 409);
  }
  if (scope.role !== 'teacher') {
    return;
  }
  const latestAssignment = await assertTeacherClassAccess(scopedDb, scope, classId, section, new Date());
  const prevId = String(assignment?._id || assignment?.id || '');
  const nextId = String(latestAssignment?._id || latestAssignment?.id || '');
  if (prevId && nextId && prevId !== nextId) {
    throw httpError('Teacher assignment changed concurrently during DLP operation; write aborted.', 409);
  }
}

async function executeFencedDlpMutation(scope, classId, section, mutationFn, onRollback) {
  const initialAssignment = await assertTeacherClassAccess(
    scope.scopedDb,
    scope,
    classId,
    section,
    new Date(),
  );

  // Allow test hooks or concurrent interleaving before final commit check
  if (typeof scope.db?.onBeforeDlpCommit === 'function') {
    await scope.db.onBeforeDlpCommit({ scope, classId, section, initialAssignment });
  }

  const result = await mutationFn(initialAssignment);

  try {
    await verifyAssignmentStillActive(scope.scopedDb, scope, initialAssignment, classId, section);
  } catch (err) {
    if (typeof onRollback === 'function') {
      await onRollback(result);
    }
    throw err;
  }

  return result;
}

function createDlpRouter({ database = getDatabase } = {}) {
  const router = express.Router();

  // Staff-only Teachers DLP directory
  router.get('/', async (req, res) => {
    try {
      const scope = await resolveDlpScope(req, database);
      const filter = {};
      if (scope.branchId) filter.branchId = scope.branchId;
      if (typeof req.query?.classId === 'string' && req.query.classId.trim()) {
        filter.classId = req.query.classId.trim();
      }
      if (typeof req.query?.section === 'string' && req.query.section.trim()) {
        filter.section = req.query.section.trim();
      }
      if (typeof req.query?.subject === 'string' && req.query.subject.trim()) {
        filter.subject = req.query.subject.trim();
      }
      if (typeof req.query?.status === 'string' && req.query.status.trim()) {
        filter.status = req.query.status.trim();
      }

      let activePairs = null;
      if (scope.role === 'teacher') {
        const now = new Date();
        const myAssignments = (await loadTeacherAssignments(scope.scopedDb, scope)).filter(
          a => String(a.branchId) === String(scope.branchId) && isAssignmentCurrentAndValid(a, now),
        );
        if (myAssignments.length === 0) {
          throw httpError('Teacher has no active class assignments for DLP directory access.', 403);
        }
        if (filter.classId && filter.section) {
          await assertTeacherClassAccess(scope.scopedDb, scope, filter.classId, filter.section, now);
        }
        activePairs = new Set(
          myAssignments.map(
            a =>
              `${String(a.classId ?? a.className ?? '').trim()}::${String(
                a.sectionId ?? a.section ?? a.sectionName ?? '',
              ).trim()}`,
          ),
        );
      }

      const dlps = await scope.scopedDb
        .collection('dlpRecords')
        .find(filter)
        .sort({ updatedAt: -1 })
        .limit(100)
        .toArray();

      const authorizedDlps =
        scope.role === 'teacher'
          ? dlps.filter(
              d =>
                scope.actorIds.has(String(d.teacherUserId)) &&
                activePairs.has(`${String(d.classId).trim()}::${String(d.section).trim()}`),
            )
          : dlps;

      return res.json({ success: true, data: authorizedDlps });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Unable to load staff DLP directory.',
      });
    }
  });

  // Get single DLP with its audience versions (staff-only, rechecks assignment access)
  router.get('/:dlpId', async (req, res) => {
    try {
      const scope = await resolveDlpScope(req, database);
      const filter = { id: String(req.params.dlpId) };
      if (scope.branchId) filter.branchId = scope.branchId;
      const dlp = await scope.scopedDb.collection('dlpRecords').findOne(filter);
      if (!dlp) {
        return res.status(404).json({ success: false, error: 'DLP record was not found.' });
      }
      if (scope.role === 'teacher') {
        if (!scope.actorIds.has(String(dlp.teacherUserId))) {
          throw httpError('Teachers may only access their own DLP records.', 403);
        }
        await assertTeacherClassAccess(scope.scopedDb, scope, dlp.classId, dlp.section);
      }
      const versions = await scope.scopedDb
        .collection('dlpVersions')
        .find({ dlpId: dlp.id, branchId: dlp.branchId })
        .sort({ createdAt: -1 })
        .limit(50)
        .toArray();
      return res.json({ success: true, data: { dlp, versions } });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Unable to load DLP details.',
      });
    }
  });

  // Get a specific DLP version (rechecks staff assignment access)
  router.get('/:dlpId/versions/:versionId', async (req, res) => {
    try {
      const scope = await resolveDlpScope(req, database);
      const filter = { id: String(req.params.dlpId) };
      if (scope.branchId) filter.branchId = scope.branchId;
      const dlp = await scope.scopedDb.collection('dlpRecords').findOne(filter);
      if (!dlp) {
        return res.status(404).json({ success: false, error: 'DLP record was not found.' });
      }
      if (scope.role === 'teacher') {
        if (!scope.actorIds.has(String(dlp.teacherUserId))) {
          throw httpError('Teachers may only access versions of their own DLP records.', 403);
        }
        await assertTeacherClassAccess(scope.scopedDb, scope, dlp.classId, dlp.section);
      }
      const version = await scope.scopedDb.collection('dlpVersions').findOne({
        id: String(req.params.versionId),
        dlpId: dlp.id,
        branchId: dlp.branchId,
      });
      if (!version) {
        return res.status(404).json({ success: false, error: 'DLP version was not found.' });
      }
      return res.json({ success: true, data: version });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Unable to load DLP version.',
      });
    }
  });

  // Prepare new DLP (Teacher or Principal)
  router.post('/', async (req, res) => {
    try {
      const scope = await resolveDlpScope(req, database);
      if (!['teacher', 'principal'].includes(scope.role)) {
        throw httpError('Only Teachers or Principals may prepare DLP records.', 403);
      }
      const title = cleanText(req.body?.title, 'DLP title', 180);
      const subject = cleanText(req.body?.subject, 'Subject', 120);
      const classId = cleanText(req.body?.classId, 'Class ID', 80);
      if (req.body?.section === undefined || req.body?.section === null || !String(req.body.section).trim()) {
        throw httpError('Section is required and cannot be defaulted.', 400);
      }
      const section = cleanText(req.body.section, 'Section', 40);
      const lessonDate = cleanText(req.body?.lessonDate || new Date().toISOString().slice(0, 10), 'Lesson date', 20);
      const objectives = cleanText(req.body?.objectives, 'Learning objectives', 2500);
      const activities = cleanText(req.body?.activities, 'Classroom activities', 3000);
      const workCompletionStatus = req.body?.workCompletionStatus || 'completed';
      if (!COMPLETION_STATUSES.has(workCompletionStatus)) {
        throw httpError('Invalid work completion status.');
      }
      const workCompletionDetails = cleanText(req.body?.workCompletionDetails, 'Work completion details', 2500);
      const homeworkAssigned = cleanText(req.body?.homeworkAssigned, 'Homework assigned', 1500, true);
      const internalStaffNotes = cleanText(req.body?.internalStaffNotes, 'Internal staff notes', 2000, true);
      const parentSummaryNotes = cleanText(req.body?.parentSummaryNotes, 'Parent summary notes', 2000, true);

      const record = await executeFencedDlpMutation(
        scope,
        classId,
        section,
        async assignment => {
          const now = new Date();
          const doc = {
            id: crypto.randomUUID(),
            branchId: scope.branchId,
            teacherUserId: scope.userId,
            teacherName: scope.actor?.fullName || scope.actor?.name || 'Teacher',
            assignmentId: assignment ? String(assignment._id || assignment.id || '') : null,
            title,
            subject,
            classId,
            section,
            lessonDate,
            objectives,
            activities,
            workCompletionStatus,
            workCompletionDetails,
            homeworkAssigned,
            internalStaffNotes,
            parentSummaryNotes: parentSummaryNotes || workCompletionDetails,
            versionNumber: 1,
            status: 'draft',
            principalReviewStatus: 'not_sent',
            parentShareStatus: 'not_shared',
            latestPrincipalVersionId: null,
            latestParentVersionId: null,
            createdAt: now,
            updatedAt: now,
          };
          await scope.scopedDb.collection('dlpRecords').insertOne(doc);
          return doc;
        },
        async createdDoc => {
          if (createdDoc?.id) {
            await scope.scopedDb.collection('dlpRecords').deleteOne({ id: createdDoc.id });
          }
        },
      );

      return res.status(201).json({ success: true, data: record });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Unable to save DLP record.',
      });
    }
  });

  // Update DLP & work-completion details (rechecks assignment & fences against concurrent revocation)
  router.patch('/:dlpId', async (req, res) => {
    try {
      const scope = await resolveDlpScope(req, database);
      const filter = { id: String(req.params.dlpId) };
      if (scope.branchId) filter.branchId = scope.branchId;
      const existing = await scope.scopedDb.collection('dlpRecords').findOne(filter);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'DLP record was not found.' });
      }
      if (scope.role === 'teacher' && !scope.actorIds.has(String(existing.teacherUserId))) {
        throw httpError('Teachers may only edit their own DLP records.', 403);
      }

      if (req.body?.classId !== undefined && String(req.body.classId).trim() !== String(existing.classId)) {
        throw httpError('DLP classId cannot be mutated after creation.', 400);
      }
      if (req.body?.section !== undefined && String(req.body.section).trim() !== String(existing.section)) {
        throw httpError('DLP section cannot be mutated after creation.', 400);
      }

      const updates = {};
      if (req.body?.title !== undefined) updates.title = cleanText(req.body.title, 'DLP title', 180);
      if (req.body?.objectives !== undefined) updates.objectives = cleanText(req.body.objectives, 'Learning objectives', 2500);
      if (req.body?.activities !== undefined) updates.activities = cleanText(req.body.activities, 'Classroom activities', 3000);
      if (req.body?.workCompletionStatus !== undefined) {
        if (!COMPLETION_STATUSES.has(req.body.workCompletionStatus)) {
          throw httpError('Invalid work completion status.');
        }
        updates.workCompletionStatus = req.body.workCompletionStatus;
      }
      if (req.body?.workCompletionDetails !== undefined) {
        updates.workCompletionDetails = cleanText(req.body.workCompletionDetails, 'Work completion details', 2500);
      }
      if (req.body?.homeworkAssigned !== undefined) {
        updates.homeworkAssigned = cleanText(req.body.homeworkAssigned, 'Homework assigned', 1500, true);
      }
      if (req.body?.internalStaffNotes !== undefined) {
        updates.internalStaffNotes = cleanText(req.body.internalStaffNotes, 'Internal staff notes', 2000, true);
      }
      if (req.body?.parentSummaryNotes !== undefined) {
        updates.parentSummaryNotes = cleanText(req.body.parentSummaryNotes, 'Parent summary notes', 2000, true);
      }

      const previousSnapshot = {
        title: existing.title,
        objectives: existing.objectives,
        activities: existing.activities,
        workCompletionStatus: existing.workCompletionStatus,
        workCompletionDetails: existing.workCompletionDetails,
        homeworkAssigned: existing.homeworkAssigned,
        internalStaffNotes: existing.internalStaffNotes,
        parentSummaryNotes: existing.parentSummaryNotes,
        versionNumber: existing.versionNumber,
        updatedAt: existing.updatedAt,
      };

      const updated = await executeFencedDlpMutation(
        scope,
        existing.classId,
        existing.section,
        async () => {
          updates.versionNumber = Number(existing.versionNumber || 1) + 1;
          updates.updatedAt = new Date();
          const resUpdate = await scope.scopedDb.collection('dlpRecords').updateOne(
            { id: existing.id, versionNumber: existing.versionNumber },
            { $set: updates },
          );
          if (!resUpdate.matchedCount) {
            throw httpError('DLP record was modified concurrently; refresh and retry.', 409);
          }
          return scope.scopedDb.collection('dlpRecords').findOne({ id: existing.id });
        },
        async () => {
          await scope.scopedDb.collection('dlpRecords').updateOne(
            { id: existing.id },
            { $set: previousSnapshot },
          );
        },
      );

      return res.json({ success: true, data: updated });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Unable to update DLP record.',
      });
    }
  });

  // Action 1: Separate "Send to Principal" sharing action
  router.post('/:dlpId/send-principal', async (req, res) => {
    try {
      const scope = await resolveDlpScope(req, database);
      if (scope.role !== 'teacher') {
        throw httpError('Only the preparing Teacher can send a DLP to the Principal.', 403);
      }
      const dlp = await scope.scopedDb.collection('dlpRecords').findOne({
        id: String(req.params.dlpId),
        branchId: scope.branchId,
      });
      if (!dlp) {
        return res.status(404).json({ success: false, error: 'DLP record was not found.' });
      }
      if (!scope.actorIds.has(String(dlp.teacherUserId))) {
        throw httpError('You can only submit your own DLP to the Principal.', 403);
      }

      const prevState = {
        principalReviewStatus: dlp.principalReviewStatus,
        latestPrincipalVersionId: dlp.latestPrincipalVersionId,
        status: dlp.status,
        updatedAt: dlp.updatedAt,
      };

      const outcome = await executeFencedDlpMutation(
        scope,
        dlp.classId,
        dlp.section,
        async () => {
          const now = new Date();
          const versionId = `dlp-prin-${dlp.id}-v${dlp.versionNumber}`;
          const existingVersion = await scope.scopedDb.collection('dlpVersions').findOne({ id: versionId });

          const principalVersion = existingVersion || {
            id: versionId,
            versionId,
            dlpId: dlp.id,
            versionNumber: dlp.versionNumber,
            audience: 'principal',
            status: 'submitted',
            sharedWithPrincipal: true,
            sharedWithParents: false,
            branchId: dlp.branchId,
            classId: dlp.classId,
            section: dlp.section,
            title: dlp.title,
            subject: dlp.subject,
            lessonDate: dlp.lessonDate,
            objectives: dlp.objectives,
            activities: dlp.activities,
            workCompletionStatus: dlp.workCompletionStatus,
            workCompletionDetails: dlp.workCompletionDetails,
            homeworkAssigned: dlp.homeworkAssigned,
            internalStaffNotes: dlp.internalStaffNotes,
            teacherUserId: dlp.teacherUserId,
            teacherName: dlp.teacherName,
            createdAt: now,
          };

          if (!existingVersion) {
            await scope.scopedDb.collection('dlpVersions').insertOne(principalVersion);
          }

          await scope.scopedDb.collection('dlpRecords').updateOne(
            { id: dlp.id },
            {
              $set: {
                principalReviewStatus: 'pending_review',
                latestPrincipalVersionId: versionId,
                status: 'submitted_to_principal',
                updatedAt: now,
              },
            },
          );

          // Deliver deduplicated review notifications to active Principals of this school & branch
          const principals = await scope.scopedDb
            .collection('users')
            .find({ role: 'principal', branchId: scope.branchId, active: { $ne: false } })
            .limit(20)
            .toArray();

          let notifiedCount = 0;
          const insertedNotifIds = [];
          for (const principal of principals) {
            if (principal.isActive === false) continue;
            const recipientUserId = principal.id || String(principal._id);
            const dedupeKey = `principal_dlp:${versionId}:${recipientUserId}`;
            const existingNotif = await scope.scopedDb
              .collection('notifications')
              .findOne({ dedupeKey });
            if (!existingNotif) {
              const notifId = crypto.randomUUID();
              await scope.scopedDb.collection('notifications').insertOne({
                id: notifId,
                dedupeKey,
                type: 'principal_dlp_review',
                recipientUserId,
                recipientRole: 'principal',
                branchId: scope.branchId,
                dlpId: dlp.id,
                dlpVersionId: versionId,
                title: `DLP Submitted for Review: ${dlp.subject}`,
                body: `${dlp.teacherName} submitted "${dlp.title}" (${dlp.workCompletionStatus.replace(/_/g, ' ')}) for Principal review.`,
                recordSnapshot: {
                  id: versionId,
                  dlpId: dlp.id,
                  title: dlp.title,
                  subject: dlp.subject,
                  classId: dlp.classId,
                  section: dlp.section,
                  workCompletionStatus: dlp.workCompletionStatus,
                  workCompletionDetails: dlp.workCompletionDetails,
                },
                createdAt: now,
                readAt: null,
              });
              insertedNotifIds.push(notifId);
              notifiedCount += 1;
            }
          }

          return {
            versionId,
            createdNewVersion: !existingVersion,
            insertedNotifIds,
            principalVersion,
            notifiedCount,
          };
        },
        async partial => {
          if (partial?.createdNewVersion && partial?.versionId) {
            await scope.scopedDb.collection('dlpVersions').deleteOne({ id: partial.versionId });
          }
          if (Array.isArray(partial?.insertedNotifIds)) {
            for (const nId of partial.insertedNotifIds) {
              await scope.scopedDb.collection('notifications').deleteOne({ id: nId });
            }
          }
          await scope.scopedDb.collection('dlpRecords').updateOne(
            { id: dlp.id },
            { $set: prevState },
          );
        },
      );

      return res.json({
        success: true,
        data: {
          dlpId: dlp.id,
          audience: 'principal',
          dlpVersion: outcome.principalVersion,
          notifiedPrincipals: outcome.notifiedCount,
        },
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Unable to send DLP to Principal.',
      });
    }
  });

  // Principal reviews a Teacher's DLP
  router.post('/:dlpId/review', async (req, res) => {
    try {
      const scope = await resolveDlpScope(req, database);
      if (scope.role !== 'principal') {
        throw httpError('Principal authority is required to review a submitted DLP.', 403);
      }
      const decision = req.body?.decision;
      if (!['approved', 'revision_requested'].includes(decision)) {
        throw httpError('Decision must be approved or revision_requested.');
      }
      const reviewNotes = cleanText(req.body?.reviewNotes, 'Review notes', 1500, true);
      const dlp = await scope.scopedDb.collection('dlpRecords').findOne({
        id: String(req.params.dlpId),
        branchId: scope.branchId,
      });
      if (!dlp) {
        return res.status(404).json({ success: false, error: 'DLP record was not found.' });
      }
      const now = new Date();
      await scope.scopedDb.collection('dlpRecords').updateOne(
        { id: dlp.id },
        {
          $set: {
            principalReviewStatus: decision,
            principalReviewNotes: reviewNotes,
            principalReviewedBy: scope.userId,
            principalReviewedAt: now,
            status: decision === 'approved' ? 'approved' : 'revision_requested',
            updatedAt: now,
          },
        },
      );
      const updated = await scope.scopedDb.collection('dlpRecords').findOne({ id: dlp.id });
      return res.json({ success: true, data: updated });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Unable to record Principal DLP review.',
      });
    }
  });

  // Action 2: Separate "Send to Parents" sharing action with audience-specific version
  router.post('/:dlpId/send-parents', async (req, res) => {
    try {
      const scope = await resolveDlpScope(req, database);
      if (!['teacher', 'principal'].includes(scope.role)) {
        throw httpError('Only authorized Teachers or Principals can share a DLP with Parents.', 403);
      }
      const dlp = await scope.scopedDb.collection('dlpRecords').findOne({
        id: String(req.params.dlpId),
        branchId: scope.branchId,
      });
      if (!dlp) {
        return res.status(404).json({ success: false, error: 'DLP record was not found.' });
      }
      if (scope.role === 'teacher' && !scope.actorIds.has(String(dlp.teacherUserId))) {
        throw httpError('Teachers may only share their own DLP records with Parents.', 403);
      }

      const customParentNotes = cleanText(
        req.body?.parentSummaryNotes || dlp.parentSummaryNotes || dlp.workCompletionDetails,
        'Parent summary',
        2000,
      );

      const prevState = {
        parentShareStatus: dlp.parentShareStatus,
        latestParentVersionId: dlp.latestParentVersionId,
        parentSummaryNotes: dlp.parentSummaryNotes,
        updatedAt: dlp.updatedAt,
      };

      const outcome = await executeFencedDlpMutation(
        scope,
        dlp.classId,
        dlp.section,
        async () => {
          const now = new Date();
          const versionId = `dlp-parent-${dlp.id}-v${dlp.versionNumber}`;
          const existingVersion = await scope.scopedDb.collection('dlpVersions').findOne({ id: versionId });

          // Notice: internalStaffNotes is strictly excluded from the parent version!
          const parentVersion = existingVersion || {
            id: versionId,
            versionId,
            dlpId: dlp.id,
            versionNumber: dlp.versionNumber,
            audience: 'parent',
            status: 'published',
            sharedWithParents: true,
            sharedWithPrincipal: false,
            branchId: dlp.branchId,
            classId: dlp.classId,
            section: dlp.section,
            title: dlp.title,
            subject: dlp.subject,
            lessonDate: dlp.lessonDate,
            objectives: dlp.objectives,
            workCompletionStatus: dlp.workCompletionStatus,
            workCompletionDetails: dlp.workCompletionDetails,
            parentSummaryNotes: customParentNotes,
            homeworkAssigned: dlp.homeworkAssigned,
            teacherName: dlp.teacherName,
            publishedAt: now,
            createdAt: now,
          };

          if (!existingVersion) {
            await scope.scopedDb.collection('dlpVersions').insertOne(parentVersion);
          }

          await scope.scopedDb.collection('dlpRecords').updateOne(
            { id: dlp.id },
            {
              $set: {
                parentShareStatus: 'shared_with_parents',
                latestParentVersionId: versionId,
                parentSummaryNotes: customParentNotes,
                updatedAt: now,
              },
            },
          );

          // 1. Class-scoped notification record
          const dedupeKey = `parent_dlp_shared:${versionId}:${dlp.classId}:${dlp.section}`;
          const existingNotification = await scope.scopedDb
            .collection('notifications')
            .findOne({ dedupeKey });

          let notification = existingNotification;
          const createdNotifIds = [];
          const createdParentNotifIds = [];

          if (!existingNotification) {
            notification = {
              id: crypto.randomUUID(),
              dedupeKey,
              type: 'parent_dlp_shared',
              audience: 'parent',
              branchId: dlp.branchId,
              classId: dlp.classId,
              section: dlp.section,
              dlpId: dlp.id,
              dlpVersionId: versionId,
              title: `Daily Lesson Plan: ${dlp.subject} — ${dlp.title}`,
              body: `${customParentNotes} (${dlp.workCompletionStatus.replace(/_/g, ' ')})`,
              createdAt: now,
              readAt: null,
            };
            await scope.scopedDb.collection('notifications').insertOne(notification);
            createdNotifIds.push(notification.id);
          }

          // 2. Per-parent notifications in `parentNotifications` for verified parents of students in this class & section
          const classStudents = await scope.scopedDb
            .collection('students')
            .find({ classId: dlp.classId })
            .limit(500)
            .toArray();
          const matchingStudents = classStudents.filter(
            st =>
              (!st.branchId || String(st.branchId) === String(dlp.branchId)) &&
              (!st.section || String(st.section) === String(dlp.section)),
          );
          const studentIds = matchingStudents
            .flatMap(st => [st.id, st._id ? String(st._id) : null])
            .filter(Boolean);

          let notifiedParentsCount = 0;
          if (studentIds.length > 0) {
            const links = await scope.scopedDb
              .collection('parentChildLinks')
              .find({
                studentId: { $in: studentIds },
                status: 'verified',
                revokedAt: null,
              })
              .limit(500)
              .toArray();

            for (const link of links) {
              const parentUserId = String(link.parentUserId || '').trim();
              if (!parentUserId) continue;
              const parentDedupeKey = `parent_dlp_shared:${versionId}:${parentUserId}:${link.studentId}`;
              const existingParentNotif = await scope.scopedDb
                .collection('parentNotifications')
                .findOne({ dedupeKey: parentDedupeKey });
              if (!existingParentNotif) {
                const pNotifId = crypto.randomUUID();
                await scope.scopedDb.collection('parentNotifications').insertOne({
                  id: pNotifId,
                  dedupeKey: parentDedupeKey,
                  parentUserId,
                  studentId: String(link.studentId),
                  type: 'parent_dlp_shared',
                  audience: 'parent',
                  branchId: dlp.branchId,
                  classId: dlp.classId,
                  section: dlp.section,
                  dlpId: dlp.id,
                  dlpVersionId: versionId,
                  title: `Daily Lesson Plan: ${dlp.subject} — ${dlp.title}`,
                  body: `${customParentNotes} (${dlp.workCompletionStatus.replace(/_/g, ' ')})`,
                  createdAt: now,
                  readAt: null,
                });
                createdParentNotifIds.push(pNotifId);
                notifiedParentsCount += 1;
              }
            }
          }

          return {
            versionId,
            createdNewVersion: !existingVersion,
            createdNotifIds,
            createdParentNotifIds,
            parentVersion,
            notification,
            notifiedParentsCount,
          };
        },
        async partial => {
          if (partial?.createdNewVersion && partial?.versionId) {
            await scope.scopedDb.collection('dlpVersions').deleteOne({ id: partial.versionId });
          }
          if (Array.isArray(partial?.createdNotifIds)) {
            for (const id of partial.createdNotifIds) {
              await scope.scopedDb.collection('notifications').deleteOne({ id });
            }
          }
          if (Array.isArray(partial?.createdParentNotifIds)) {
            for (const id of partial.createdParentNotifIds) {
              await scope.scopedDb.collection('parentNotifications').deleteOne({ id });
            }
          }
          await scope.scopedDb.collection('dlpRecords').updateOne(
            { id: dlp.id },
            { $set: prevState },
          );
        },
      );

      return res.json({
        success: true,
        data: {
          dlpId: dlp.id,
          audience: 'parent',
          dlpVersion: outcome.parentVersion,
          notificationId: outcome.notification.id,
          notifiedParents: outcome.notifiedParentsCount,
        },
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Unable to share DLP with Parents.',
      });
    }
  });

  return router;
}

module.exports = {
  createDlpRouter,
  assertTeacherClassAccess,
  isAssignmentCurrentAndValid,
};
