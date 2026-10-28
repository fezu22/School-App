const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const { ObjectId } = require('mongodb');
const { createRecordedLessonRouter } = require('./recordedLessonRoutes');

function createMp4Buffer() {
  // Valid MP4 header with 'ftyp' box at bytes 4..8
  return Buffer.from([
    0x00, 0x00, 0x00, 0x18,
    0x66, 0x74, 0x79, 0x70, // 'ftyp'
    0x69, 0x73, 0x6f, 0x6d, // 'isom'
    0x00, 0x00, 0x02, 0x00,
    0x69, 0x73, 0x6f, 0x6d,
    0x69, 0x73, 0x6f, 0x32,
  ]);
}

function createFixture(customAiAdapter) {
  const schoolId = new ObjectId();
  const branchId = new ObjectId();
  const teacherActor = {
    _id: new ObjectId(),
    id: 'teacher-rec-1',
    fullName: 'Usman Raza',
    role: 'teacher',
    schoolId,
    branchId: branchId.toHexString(),
    active: true,
    isActive: true,
  };
  const principalActor = {
    _id: new ObjectId(),
    id: 'principal-rec-1',
    fullName: 'Principal Ayesha',
    role: 'principal',
    schoolId,
    branchId: branchId.toHexString(),
    active: true,
    isActive: true,
  };
  const studentActor = {
    _id: new ObjectId(),
    id: 'student-user-1',
    fullName: 'Zainab Ali',
    role: 'student',
    schoolId,
    branchId: branchId.toHexString(),
    active: true,
    isActive: true,
  };
  const wrongSectionStudentActor = {
    _id: new ObjectId(),
    id: 'student-user-2',
    fullName: 'Bilal Ahmed',
    role: 'student',
    schoolId,
    branchId: branchId.toHexString(),
    active: true,
    isActive: true,
  };
  const parentActor = {
    _id: new ObjectId(),
    id: 'parent-user-1',
    fullName: 'Tariq Ali',
    role: 'parent',
    schoolId,
    branchId: branchId.toHexString(),
    active: true,
    isActive: true,
  };
  const unlinkedParentActor = {
    _id: new ObjectId(),
    id: 'parent-user-unlinked',
    fullName: 'Unlinked Parent',
    role: 'parent',
    schoolId,
    branchId: branchId.toHexString(),
    active: true,
    isActive: true,
  };

  const now = new Date();
  const store = {
    schools: [{ _id: schoolId, name: 'Greenwood School', isActive: true, active: true, status: 'active' }],
    branches: [{ _id: branchId, id: branchId.toHexString(), schoolId, name: 'Main Campus', isActive: true, active: true }],
    users: [teacherActor, principalActor, studentActor, wrongSectionStudentActor, parentActor, unlinkedParentActor],
    students: [
      {
        _id: new ObjectId(),
        id: 'student-1',
        userId: studentActor.id,
        schoolId,
        branchId: branchId.toHexString(),
        classId: 'class-9',
        section: 'A',
        fullName: 'Zainab Ali',
      },
      {
        _id: new ObjectId(),
        id: 'student-2',
        userId: wrongSectionStudentActor.id,
        schoolId,
        branchId: branchId.toHexString(),
        classId: 'class-9',
        section: 'B',
        fullName: 'Bilal Ahmed',
      },
    ],
    parentChildLinks: [
      {
        _id: new ObjectId(),
        parentUserId: parentActor.id,
        studentId: 'student-1',
        schoolId,
        status: 'verified',
        revokedAt: null,
      },
    ],
    teacherassignments: [
      {
        _id: new ObjectId(),
        id: 'assign-rec-1',
        schoolId,
        branchId: branchId.toHexString(),
        teacherId: teacherActor.id,
        classId: 'class-9',
        sectionId: 'A',
        section: 'A',
        validFrom: new Date(now.getTime() - 86400_000),
        validUntil: new Date(now.getTime() + 30 * 86400_000),
        isActive: true,
        active: true,
        revokedAt: null,
      },
      {
        _id: new ObjectId(),
        id: 'assign-rec-2',
        schoolId,
        branchId: branchId.toHexString(),
        teacherId: teacherActor.id,
        classId: 'class-10',
        sectionId: 'B',
        section: 'B',
        validFrom: new Date(now.getTime() - 86400_000),
        validUntil: new Date(now.getTime() + 30 * 86400_000),
        isActive: true,
        active: true,
        revokedAt: null,
      },
    ],
    teacherAssignments: [],
    schoolclasses: [],
    schoolClasses: [],
    sections: [],
    recordedLessons: [],
    recordedLessonMedia: [],
    learningResources: [],
    learningProgress: [],
    quizzes: [],
    quizAttempts: [],
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

  const router = createRecordedLessonRouter({
    database: () => db,
    ...(customAiAdapter ? { aiAdapter: customAiAdapter } : {}),
  });

  function request(method, url, body, actor = teacherActor) {
    return new Promise((resolve, reject) => {
      const headers = {};
      const req = {
        method,
        url,
        path: url.split('?')[0],
        query: {},
        headers,
        get: name => headers[String(name).toLowerCase()],
        body,
        user: { id: actor.id, role: actor.role, branchId: actor.branchId },
        authenticatedUserRecord: actor,
      };
      let statusCode = 200;
      const responseHeaders = {};
      const res = {
        setHeader(k, v) { responseHeaders[k.toLowerCase()] = v; },
        status(code) { statusCode = code; return this; },
        json(payload) { resolve({ status: statusCode, headers: responseHeaders, body: payload }); return this; },
        send(payload) { resolve({ status: statusCode, headers: responseHeaders, body: payload }); return this; },
      };
      router.handle(req, res, err => (err ? reject(err) : resolve({ status: 404, body: {} })));
    });
  }

  return {
    db,
    request,
    teacherActor,
    principalActor,
    studentActor,
    wrongSectionStudentActor,
    parentActor,
    unlinkedParentActor,
    schoolId,
    branchId,
  };
}

test('Recorded lesson workflow validates media, rejects fake storage:// URLs, enforces Teacher review before publication, and provides protected playback, quiz attempts, progress, and Teacher/Parent visibility', async () => {
  const f = createFixture(async ({ title, subject }) => ({
    summary: `AI Draft Summary for ${title} (${subject})`,
    revisionNotes: '1. Cell membrane regulates transport.\n2. Mitochondria produce ATP.',
    quizQuestions: [
      {
        prompt: 'Which organelle produces ATP?',
        options: ['Nucleus', 'Mitochondria', 'Ribosome'],
        correctOption: 1,
      },
    ],
  }));

  // 0. Rejects fake storage:// URLs
  const fakeUrlAttempt = await f.request('POST', '/', {
    title: 'Fake Storage URL Lesson',
    subject: 'Biology',
    classId: 'class-9',
    section: 'A',
    mediaUrl: 'storage://school-media/recorded-lesson.mp4',
    transcriptText: 'Transcript...',
  });
  assert.equal(fakeUrlAttempt.status, 400);

  // 0b. Rejects unassigned class/section for Teacher
  const unassignedAttempt = await f.request('POST', '/', {
    title: 'Unassigned Class Lesson',
    subject: 'Biology',
    classId: 'class-9',
    section: 'C',
    transcriptText: 'Transcript...',
  });
  assert.equal(unassignedAttempt.status, 403);

  // 1. Upload recorded lesson with validated MP4 media binary and chapter/topic metadata
  const mp4Buffer = createMp4Buffer();
  const uploaded = await f.request('POST', '/', {
    title: 'Cellular Respiration & ATP',
    subject: 'Biology',
    chapter: 'Chapter 4: Bioenergetics',
    topic: 'Aerobic Respiration',
    classId: 'class-9',
    section: 'A',
    durationSeconds: 1200,
    mediaBase64: mp4Buffer.toString('base64'),
    mediaFileName: 'cellular-respiration.mp4',
    mediaContentType: 'video/mp4',
    transcriptText: 'Today we explore how mitochondria generate ATP through cellular respiration...',
  });
  assert.equal(uploaded.status, 201);
  const lessonId = uploaded.body.data.id;
  assert.equal(uploaded.body.data.published, false);
  assert.equal(uploaded.body.data.chapter, 'Chapter 4: Bioenergetics');
  assert.equal(uploaded.body.data.topic, 'Aerobic Respiration');
  assert.equal(uploaded.body.data.sourceVersion, 1);
  assert.equal(uploaded.body.data.mediaStatus, 'stored_verified');
  assert.equal(uploaded.body.data.mediaPlaybackPath, `/api/recorded-lessons/${lessonId}/media`);

  // Student cannot play media or attempt quiz before publication
  const prematureStudentMedia = await f.request('GET', `/${lessonId}/media`, null, f.studentActor);
  assert.equal(prematureStudentMedia.status, 403);
  const prematureQuizAttempt = await f.request(
    'POST',
    `/${lessonId}/quiz-attempts`,
    { answers: { 'q-1': 1 } },
    f.studentActor,
  );
  assert.equal(prematureQuizAttempt.status, 403);

  // 2. Attempting to publish before Teacher review is rejected with 409
  const prematurePublish = await f.request('POST', `/${lessonId}/publish`, {});
  assert.equal(prematurePublish.status, 409);

  // 3. Process AI draft -> stays unpublished until Teacher reviews
  const processed = await f.request('POST', `/${lessonId}/process-ai`, {});
  assert.equal(processed.status, 200);
  assert.equal(processed.body.data.jobStatus, 'ai_draft_ready');
  assert.equal(processed.body.data.published, false);
  assert.equal(processed.body.data.teacherReviewed, false);

  // Still cannot publish without explicit Teacher review & approval
  const stillUnreviewed = await f.request('POST', `/${lessonId}/publish`, {});
  assert.equal(stillUnreviewed.status, 409);

  // 4. Teacher reviews, edits, and approves
  const reviewed = await f.request('POST', `/${lessonId}/review`, {
    approved: true,
    summary: 'Teacher-verified summary: Cellular respiration converts glucose into ATP in mitochondria.',
    revisionNotes: 'Key equation: C6H12O6 + 6O2 -> 6CO2 + 6H2O + ATP',
    quizQuestions: processed.body.data.aiDraft.quizQuestions,
  });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.body.data.teacherReviewed, true);
  assert.equal(reviewed.body.data.reviewedSourceVersion, 1);

  // 5. Publish succeeds, syncs learningResources, and publishes quiz for eligible Students
  const published = await f.request('POST', `/${lessonId}/publish`, {});
  assert.equal(published.status, 200);
  assert.equal(published.body.data.lesson.published, true);
  assert.ok(published.body.data.publishedQuizId);
  assert.equal(f.db.store.quizzes.length, 1);
  assert.equal(f.db.store.learningResources.length, 1);

  // Eligible Student in class-9 section A can now stream the protected media binary
  const studentMedia = await f.request('GET', `/${lessonId}/media`, null, f.studentActor);
  assert.equal(studentMedia.status, 200);
  assert.equal(studentMedia.headers['content-type'], 'video/mp4');
  assert.ok(Buffer.isBuffer(studentMedia.body));
  assert.equal(studentMedia.body.length, mp4Buffer.length);

  // Student in wrong section (Section B) and unlinked Parent are denied media & quiz access
  const wrongSectionMedia = await f.request('GET', `/${lessonId}/media`, null, f.wrongSectionStudentActor);
  assert.equal(wrongSectionMedia.status, 403);
  const wrongSectionQuiz = await f.request(
    'POST',
    `/${lessonId}/quiz-attempts`,
    { answers: { 'q-1': 1 } },
    f.wrongSectionStudentActor,
  );
  assert.equal(wrongSectionQuiz.status, 403);
  const unlinkedParentMedia = await f.request('GET', `/${lessonId}/media`, null, f.unlinkedParentActor);
  assert.equal(unlinkedParentMedia.status, 403);

  // 5b. Enrolled Student records playback progress and submits quiz attempt
  const progressSaved = await f.request(
    'POST',
    `/${lessonId}/progress`,
    { percent: 100, watchedSeconds: 1200 },
    f.studentActor,
  );
  assert.equal(progressSaved.status, 200);
  assert.equal(progressSaved.body.data.percent, 100);

  const quizScored = await f.request(
    'POST',
    `/${lessonId}/quiz-attempts`,
    { answers: { 'q-1': 1 } },
    f.studentActor,
  );
  assert.equal(quizScored.status, 201);
  assert.equal(quizScored.body.data.score, 1);
  assert.equal(quizScored.body.data.total, 1);
  assert.equal(quizScored.body.data.percentage, 100);

  // 5c. Teacher and Verified Parent can view the student's playback progress and quiz score
  const teacherResults = await f.request('GET', `/${lessonId}/results`, null, f.teacherActor);
  assert.equal(teacherResults.status, 200);
  assert.equal(teacherResults.body.data.progress.length, 1);
  assert.equal(teacherResults.body.data.quizAttempts.length, 1);
  assert.equal(teacherResults.body.data.quizAttempts[0].score, 1);

  const parentResults = await f.request('GET', `/${lessonId}/results`, null, f.parentActor);
  assert.equal(parentResults.status, 200);
  assert.equal(parentResults.body.data.progress.length, 1);
  assert.equal(parentResults.body.data.quizAttempts.length, 1);
  assert.equal(parentResults.body.data.quizAttempts[0].studentId, 'student-1');

  const unlinkedParentResults = await f.request('GET', `/${lessonId}/results`, null, f.unlinkedParentActor);
  assert.equal(unlinkedParentResults.status, 403);

  // 6. Updating source transcript increments sourceVersion to 2 and requires re-review before publishing
  const sourceUpdated = await f.request('PATCH', `/${lessonId}/source`, {
    transcriptText: 'Updated transcript adding Krebs cycle details...',
  });
  assert.equal(sourceUpdated.status, 200);
  assert.equal(sourceUpdated.body.data.sourceVersion, 2);
  assert.equal(sourceUpdated.body.data.published, false);
  assert.equal(sourceUpdated.body.data.teacherReviewed, false);

  const publishStaleReview = await f.request('POST', `/${lessonId}/publish`, {});
  assert.equal(publishStaleReview.status, 409);
});

test('Source-version fencing prevents an outdated in-flight AI response from overwriting a newer sourceVersion', async () => {
  let f;
  f = createFixture(async () => {
    // Simulate a concurrent source update bumping sourceVersion from 1 to 2 while AI is generating
    f.db.store.recordedLessons[0].sourceVersion = 2;
    f.db.store.recordedLessons[0].transcriptText = 'Newer transcript v2';
    return {
      summary: 'Stale v1 AI Summary',
      revisionNotes: 'Stale v1 Revision Notes',
      quizQuestions: [
        {
          prompt: 'Stale Q?',
          options: ['A', 'B'],
          correctOption: 0,
        },
      ],
    };
  });

  const uploaded = await f.request('POST', '/', {
    title: 'Wave Optics',
    subject: 'Physics',
    classId: 'class-9',
    section: 'A',
    transcriptText: 'Initial transcript v1...',
  });
  assert.equal(uploaded.status, 201);
  const lessonId = uploaded.body.data.id;

  const staleAiAttempt = await f.request('POST', `/${lessonId}/process-ai`, {});
  assert.equal(staleAiAttempt.status, 409);
  assert.equal(staleAiAttempt.body.code, 'STALE_SOURCE_VERSION');
  assert.equal(f.db.store.recordedLessons[0].sourceVersion, 2);
  assert.equal(f.db.store.recordedLessons[0].aiDraft, null);
});

test('Unconfigured GEMINI_API_KEY never fabricates AI output, and retention/deletion rules purge expired media', async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const f = createFixture();
    const mp4Buffer = createMp4Buffer();
    const uploaded = await f.request('POST', '/', {
      title: 'Newton Laws of Motion',
      subject: 'Physics',
      classId: 'class-10',
      section: 'B',
      mediaBase64: mp4Buffer.toString('base64'),
      mediaFileName: 'newton.mp4',
      mediaContentType: 'video/mp4',
      transcriptText: 'First law of motion states that an object remains at rest or uniform motion...',
    });
    const lessonId = uploaded.body.data.id;

    const aiAttempt = await f.request('POST', `/${lessonId}/process-ai`, {});
    assert.equal(aiAttempt.status, 503);
    assert.equal(aiAttempt.body.code, 'AI_CONFIGURATION_REQUIRED');

    const stored = f.db.store.recordedLessons[0];
    assert.equal(stored.jobStatus, 'ai_configuration_required');
    assert.equal(stored.aiDraft, null);

    // Expire retention date and verify playback returns 410 and purge removes media binary
    stored.retentionExpiresAt = new Date(Date.now() - 1000);
    const expiredPlayback = await f.request('GET', `/${lessonId}/media`);
    assert.equal(expiredPlayback.status, 410);

    const purged = await f.request('POST', '/purge-expired', {}, f.principalActor);
    assert.equal(purged.status, 200);
    assert.equal(purged.body.data.purgedCount, 1);
    assert.equal(f.db.store.recordedLessonMedia.length, 0);
  } finally {
    if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
  }
});
