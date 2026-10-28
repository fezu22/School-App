const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { createDlpRouter } = require('./dlpRoutes');

function createFixture() {
  const schoolId = new ObjectId();
  const otherSchoolId = new ObjectId();
  const branchId = new ObjectId();
  const otherBranchId = new ObjectId();
  const classId = new ObjectId().toHexString();
  const otherClassId = new ObjectId().toHexString();

  const teacherUser = {
    _id: new ObjectId(),
    id: 'teacher-1',
    fullName: 'Sarah Wilson',
    role: 'teacher',
    schoolId,
    branchId: branchId.toHexString(),
    active: true,
    isActive: true,
  };

  const principalUser = {
    _id: new ObjectId(),
    id: 'principal-1',
    fullName: 'Principal Tariq',
    role: 'principal',
    schoolId,
    branchId: branchId.toHexString(),
    active: true,
    isActive: true,
  };

  const parentUser = {
    _id: new ObjectId(),
    id: 'parent-1',
    fullName: 'Parent Fatima',
    role: 'parent',
    schoolId,
    branchId: branchId.toHexString(),
    active: true,
    isActive: true,
  };

  const now = new Date();
  const activeAssignment = {
    _id: new ObjectId(),
    id: 'assign-1',
    schoolId,
    branchId: branchId.toHexString(),
    teacherId: teacherUser.id,
    classId,
    sectionId: 'A',
    section: 'A',
    validFrom: new Date(now.getTime() - 86400_000),
    validUntil: new Date(now.getTime() + 30 * 86400_000),
    isActive: true,
    active: true,
    revokedAt: null,
  };

  const store = {
    schools: [
      { _id: schoolId, name: 'Greenwood School', isActive: true, active: true, status: 'active' },
      { _id: otherSchoolId, name: 'Other School', isActive: true, active: true, status: 'active' },
    ],
    branches: [
      { _id: branchId, id: branchId.toHexString(), schoolId, name: 'Main Campus', isActive: true, active: true },
      { _id: otherBranchId, id: otherBranchId.toHexString(), schoolId, name: 'North Campus', isActive: true, active: true },
    ],
    users: [principalUser, teacherUser, parentUser],
    teacherassignments: [activeAssignment],
    teacherAssignments: [],
    schoolclasses: [
      { _id: new ObjectId(classId), id: classId, schoolId, branchId: branchId.toHexString(), name: 'Grade 9', isActive: true },
      { _id: new ObjectId(otherClassId), id: otherClassId, schoolId, branchId: branchId.toHexString(), name: 'Grade 10', isActive: true },
    ],
    schoolClasses: [],
    sections: [
      { _id: new ObjectId(), id: 'A', name: 'A', schoolId, branchId: branchId.toHexString(), classId, isActive: true },
      { _id: new ObjectId(), id: 'B', name: 'B', schoolId, branchId: branchId.toHexString(), classId, isActive: true },
    ],
    students: [
      {
        _id: new ObjectId(),
        id: 'student-1',
        schoolId,
        branchId: branchId.toHexString(),
        classId,
        section: 'A',
        fullName: 'Ali Khan',
      },
    ],
    parentChildLinks: [
      {
        _id: new ObjectId(),
        id: 'link-1',
        schoolId,
        parentUserId: parentUser.id,
        studentId: 'student-1',
        status: 'verified',
        revokedAt: null,
      },
    ],
    dlpRecords: [],
    dlpVersions: [],
    notifications: [],
    parentNotifications: [],
  };

  function matches(doc, filter = {}) {
    if (filter.$and) return filter.$and.every(sub => matches(doc, sub));
    if (filter.$or) return filter.$or.some(sub => matches(doc, sub));
    return Object.entries(filter).every(([k, v]) => {
      if (v && typeof v === 'object' && !(v instanceof ObjectId) && !(v instanceof Date)) {
        if (v.$ne !== undefined) return doc[k] !== v.$ne;
        if (v.$in) return v.$in.some(x => String(doc[k]) === String(x));
      }
      if (v === null) return doc[k] == null;
      return String(doc[k]) === String(v);
    });
  }

  const db = {
    store,
    onBeforeDlpCommit: null,
    collection(name) {
      if (!store[name]) store[name] = [];
      const rows = store[name];
      return {
        findOne: async filter => rows.find(r => matches(r, filter)) || null,
        find: filter => {
          const found = rows.filter(r => matches(r, filter));
          return {
            sort() { return this; },
            limit(n) { return { toArray: async () => found.slice(0, n) }; },
            toArray: async () => found,
          };
        },
        insertOne: async doc => {
          rows.push({ ...doc });
          return { insertedId: doc._id || new ObjectId() };
        },
        updateOne: async (filter, update) => {
          const row = rows.find(r => matches(r, filter));
          if (!row) return { matchedCount: 0, modifiedCount: 0 };
          if (update.$set) Object.assign(row, update.$set);
          return { matchedCount: 1, modifiedCount: 1 };
        },
        deleteOne: async filter => {
          const idx = rows.findIndex(r => matches(r, filter));
          if (idx === -1) return { deletedCount: 0 };
          rows.splice(idx, 1);
          return { deletedCount: 1 };
        },
      };
    },
  };

  const router = createDlpRouter({ database: () => db });

  function request(method, url, body, actor = teacherUser) {
    return new Promise((resolve, reject) => {
      const req = {
        method,
        url,
        path: url.split('?')[0],
        query: {},
        headers: {},
        body,
        user: { id: actor.id, role: actor.role, branchId: actor.branchId },
        authenticatedUserRecord: actor,
      };
      let statusCode = 200;
      const res = {
        status(code) { statusCode = code; return this; },
        json(payload) { resolve({ status: statusCode, body: payload }); return this; },
      };
      router.handle(req, res, err => (err ? reject(err) : resolve({ status: 404, body: {} })));
    });
  }

  return {
    db,
    request,
    teacherActor: teacherUser,
    principalActor: principalUser,
    parentActor: parentUser,
    activeAssignment,
    schoolId,
    otherSchoolId,
    branchId,
    otherBranchId,
    classId,
    otherClassId,
  };
}

test('Staff DLP directory denies Parents/Students, requires persisted active user, and enforces school isolation', async () => {
  const f = createFixture();
  const parentAttempt = await f.request('GET', '/', null, f.parentActor);
  assert.equal(parentAttempt.status, 403);

  const studentAttempt = await f.request('GET', '/', null, { ...f.parentActor, role: 'student' });
  assert.equal(studentAttempt.status, 403);

  // Unpersisted user is denied
  const unpersistedTeacher = {
    _id: new ObjectId(),
    id: 'ghost-teacher',
    role: 'teacher',
    schoolId: f.schoolId,
    branchId: f.branchId.toHexString(),
  };
  const ghostAttempt = await f.request('GET', '/', null, unpersistedTeacher);
  assert.equal(ghostAttempt.status, 403);

  // Foreign school DLP must never appear in this school's directory
  f.db.store.dlpRecords.push({
    id: 'foreign-dlp',
    schoolId: f.otherSchoolId,
    branchId: f.branchId.toHexString(),
    title: 'Foreign School DLP',
  });
  const list = await f.request('GET', '/', null, f.teacherActor);
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 0);
});

test('DLP authorization enforces zero-assignments denial, missing section rejection, reassignment, revocation, date boundaries, and cross-branch/class/section checks', async () => {
  const f = createFixture();

  const validBody = {
    title: 'Linear Equations & Modeling',
    subject: 'Mathematics',
    classId: f.classId,
    section: 'A',
    lessonDate: '2026-10-26',
    objectives: 'Solve two-step linear equations with rational coefficients.',
    activities: 'Guided whiteboard modeling + paired problem sets.',
    workCompletionStatus: 'completed',
    workCompletionDetails: 'Completed examples 1-6; 24/26 students mastered exit ticket.',
  };

  // 1. Missing section must NOT default to 'A'
  const missingSection = await f.request('POST', '/', {
    ...validBody,
    section: '',
  });
  assert.equal(missingSection.status, 400);

  // 2. Teacher with zero assignments is strictly denied (both GET and POST)
  f.db.store.teacherassignments = [];
  const zeroAssignGet = await f.request('GET', '/');
  assert.equal(zeroAssignGet.status, 403);

  const zeroAssignPost = await f.request('POST', '/', validBody);
  assert.equal(zeroAssignPost.status, 403);

  // Restore assignment
  f.db.store.teacherassignments = [{ ...f.activeAssignment }];

  // 3. Cross-section access (assigned to section A, attempting section B) is denied
  const wrongSection = await f.request('POST', '/', {
    ...validBody,
    section: 'B',
  });
  assert.equal(wrongSection.status, 403);

  // 4. Cross-class access (assigned to classId, attempting otherClassId) is denied
  const wrongClass = await f.request('POST', '/', {
    ...validBody,
    classId: f.otherClassId,
  });
  assert.equal(wrongClass.status, 403);

  // 5. Cross-branch assignment is denied
  f.db.store.teacherassignments = [
    { ...f.activeAssignment, branchId: f.otherBranchId.toHexString() },
  ];
  const wrongBranch = await f.request('POST', '/', validBody);
  assert.equal(wrongBranch.status, 403);

  // 6. Future validFrom date boundary is denied
  f.db.store.teacherassignments = [
    {
      ...f.activeAssignment,
      validFrom: new Date(Date.now() + 7 * 86400_000),
      validUntil: new Date(Date.now() + 30 * 86400_000),
    },
  ];
  const futureAssignment = await f.request('POST', '/', validBody);
  assert.equal(futureAssignment.status, 403);

  // 7. Expired validUntil date boundary is denied
  f.db.store.teacherassignments = [
    {
      ...f.activeAssignment,
      validFrom: new Date(Date.now() - 30 * 86400_000),
      validUntil: new Date(Date.now() - 86400_000),
    },
  ];
  const expiredAssignment = await f.request('POST', '/', validBody);
  assert.equal(expiredAssignment.status, 403);

  // 8. Revoked assignment is denied
  f.db.store.teacherassignments = [
    {
      ...f.activeAssignment,
      revokedAt: new Date(),
    },
  ];
  const revokedAssignment = await f.request('POST', '/', validBody);
  assert.equal(revokedAssignment.status, 403);

  // 9. Reassignment after DLP creation blocks Teacher from reading, editing, or sharing old class DLP
  f.db.store.teacherassignments = [{ ...f.activeAssignment }];
  const created = await f.request('POST', '/', validBody);
  assert.equal(created.status, 201);
  const dlpId = created.body.data.id;

  // Reassign teacher from section A to section B
  f.db.store.teacherassignments = [
    { ...f.activeAssignment, sectionId: 'B', section: 'B' },
  ];
  const getAfterReassign = await f.request('GET', `/${dlpId}`);
  assert.equal(getAfterReassign.status, 403);

  const editAfterReassign = await f.request('PATCH', `/${dlpId}`, {
    title: 'Unauthorized Edit After Reassignment',
  });
  assert.equal(editAfterReassign.status, 403);

  const shareAfterReassign = await f.request('POST', `/${dlpId}/send-parents`, {});
  assert.equal(shareAfterReassign.status, 403);
});

test('Concurrent assignment revocation during DLP write or share aborts and rolls back changes', async () => {
  const f = createFixture();
  const validBody = {
    title: 'Concurrent Fencing Test DLP',
    subject: 'Mathematics',
    classId: f.classId,
    section: 'A',
    lessonDate: '2026-10-26',
    objectives: 'Verify assignment fencing.',
    activities: 'Fenced transaction test.',
    workCompletionStatus: 'completed',
    workCompletionDetails: 'Completed all exercises.',
  };

  // Simulate concurrent revocation during POST /
  f.db.onBeforeDlpCommit = async () => {
    f.db.store.teacherassignments[0].revokedAt = new Date();
    f.db.store.teacherassignments[0].isActive = false;
  };
  const abortedCreate = await f.request('POST', '/', validBody);
  assert.equal(abortedCreate.status, 403);
  assert.equal(f.db.store.dlpRecords.length, 0);

  // Restore assignment and create DLP cleanly
  f.db.onBeforeDlpCommit = null;
  f.db.store.teacherassignments[0].revokedAt = null;
  f.db.store.teacherassignments[0].isActive = true;
  const created = await f.request('POST', '/', validBody);
  assert.equal(created.status, 201);
  const dlpId = created.body.data.id;

  // Simulate concurrent revocation during send-parents
  f.db.onBeforeDlpCommit = async () => {
    f.db.store.teacherassignments[0].revokedAt = new Date();
  };
  const abortedShare = await f.request('POST', `/${dlpId}/send-parents`, {});
  assert.equal(abortedShare.status, 403);
  assert.equal(f.db.store.dlpVersions.length, 0);
  assert.equal(f.db.store.parentNotifications.length, 0);
  assert.equal(f.db.store.dlpRecords[0].parentShareStatus, 'not_shared');
});

test('Teacher prepares DLP, sends internal version to Principal, and sends separate parent-safe version to Parents with verified parentNotifications', async () => {
  const f = createFixture();
  const created = await f.request('POST', '/', {
    title: 'Linear Equations & Modeling',
    subject: 'Mathematics',
    classId: f.classId,
    section: 'A',
    lessonDate: '2026-10-26',
    objectives: 'Solve two-step linear equations with rational coefficients.',
    activities: 'Guided whiteboard modeling + paired problem sets.',
    workCompletionStatus: 'completed',
    workCompletionDetails: 'Completed examples 1-6; 24/26 students mastered exit ticket.',
    homeworkAssigned: 'Worksheet 4B Q1-Q8',
    internalStaffNotes: 'CONFIDENTIAL STAFF NOTE: Need extra remedial coaching for 2 students.',
    parentSummaryNotes: 'Students practiced solving two-step linear equations in class today.',
  });
  assert.equal(created.status, 201);
  const dlpId = created.body.data.id;

  // Send to Principal
  const sentPrincipal = await f.request('POST', `/${dlpId}/send-principal`, {});
  assert.equal(sentPrincipal.status, 200);
  assert.equal(sentPrincipal.body.data.audience, 'principal');
  assert.equal(sentPrincipal.body.data.notifiedPrincipals, 1);
  assert.ok(sentPrincipal.body.data.dlpVersion.internalStaffNotes.includes('CONFIDENTIAL STAFF NOTE'));

  // Re-sending same version to Principal does not duplicate Principal notification
  const sentPrincipalAgain = await f.request('POST', `/${dlpId}/send-principal`, {});
  assert.equal(sentPrincipalAgain.status, 200);
  assert.equal(sentPrincipalAgain.body.data.notifiedPrincipals, 0);

  // Principal reviews and approves DLP
  const reviewed = await f.request(
    'POST',
    `/${dlpId}/review`,
    { decision: 'approved', reviewNotes: 'Well structured lesson and clear completion metrics.' },
    f.principalActor,
  );
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.body.data.principalReviewStatus, 'approved');

  // Send to Parents creates separate audience-specific version WITHOUT internalStaffNotes
  const sentParents = await f.request('POST', `/${dlpId}/send-parents`, {});
  assert.equal(sentParents.status, 200);
  assert.equal(sentParents.body.data.audience, 'parent');
  assert.equal(sentParents.body.data.dlpVersion.sharedWithParents, true);
  assert.equal(sentParents.body.data.dlpVersion.status, 'published');
  assert.equal(sentParents.body.data.dlpVersion.internalStaffNotes, undefined);
  assert.equal(
    sentParents.body.data.dlpVersion.parentSummaryNotes,
    'Students practiced solving two-step linear equations in class today.',
  );
  assert.equal(sentParents.body.data.notifiedParents, 1);

  const parentNotifications = f.db.store.parentNotifications.filter(n => n.type === 'parent_dlp_shared');
  assert.equal(parentNotifications.length, 1);
  assert.equal(parentNotifications[0].parentUserId, f.parentActor.id);
  assert.equal(parentNotifications[0].dlpVersionId, sentParents.body.data.dlpVersion.id);
});
