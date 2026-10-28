const crypto = require('node:crypto');
const express = require('express');
const { ObjectId } = require('mongodb');
const { getDatabase } = require('./database');

const { schoolFieldMatch } = require('./schoolAccess');

const published = { $or: [{ published: true }, { status: 'published' }] };
const text = (value, max = 2000) =>
  typeof value === 'string' && value.trim() && value.trim().length <= max
    ? value.trim()
    : null;
const idFilter = id => ({
  $or: [
    { id },
    ...(ObjectId.isValid(id) ? [{ _id: new ObjectId(id) }] : []),
  ],
});

function studentSchoolFilter(student) {
  if (student?.tenantScope?.schoolFilter) return student.tenantScope.schoolFilter;
  if (student?.schoolId) return schoolFieldMatch(student.schoolId);
  return null;
}

function studentSchoolRecordFields(student) {
  const schoolId = student?.tenantScope?.schoolIdHex || (student?.schoolId ? String(student.schoolId) : null);
  return schoolId ? { schoolId } : {};
}

function audience(student) {
  const schoolClause = studentSchoolFilter(student);
  const sectionClause = student.section
    ? {
        $or: [
          { section: student.section },
          { section: { $exists: false } },
          { section: null },
          { section: '' },
        ],
      }
    : null;
  return {
    branchId: student.branchId,
    $and: [
      published,
      {
        $or: [
          { studentId: student.id },
          { studentIds: student.id },
          ...(student.classId ? [{ classId: student.classId }] : []),
          { audience: 'all' },
        ],
      },
      ...(sectionClause ? [sectionClause] : []),
      ...(schoolClause ? [schoolClause] : []),
    ],
  };
}

function owned(student, actor, extra = {}) {
  return {
    ...extra,
    ...(studentSchoolFilter(student) || {}),
    studentId: student.id,
    actorUserId: actor.id,
    actorRole: actor.role,
  };
}

function safeQuiz(quiz) {
  return {
    ...quiz,
    questions: (quiz.questions || []).map(question => {
      const { answer, correctAnswer, correctOptionId, correctOption, explanation, ...safe } = question;
      return safe;
    }),
  };
}

function scoreQuiz(quiz, answers) {
  const questions = Array.isArray(quiz.questions) ? quiz.questions : [];
  const submitted = answers && typeof answers === 'object' ? answers : {};
  let earnedPoints = 0;
  let totalPoints = 0;
  const score = questions.reduce((total, question, index) => {
    const pts = Math.max(1, Number(question.points) || 1);
    totalPoints += pts;
    const key = String(question.id ?? index);
    const rawSubmitted = submitted[key] !== undefined ? submitted[key] : submitted[String(index)];
    if (rawSubmitted === undefined || rawSubmitted === null) return total;

    const hasIndexExpected =
      question.correctOption !== undefined &&
      question.correctOption !== null &&
      Number.isInteger(Number(question.correctOption));
    if (hasIndexExpected) {
      const expectedIdx = Number(question.correctOption);
      const expectedText = Array.isArray(question.options) ? question.options[expectedIdx] : undefined;
      const isCorrect =
        Number(rawSubmitted) === expectedIdx ||
        (expectedText !== undefined && String(rawSubmitted) === String(expectedText));
      if (isCorrect) {
        earnedPoints += pts;
        return total + 1;
      }
      return total;
    }

    const expected = question.correctOptionId ?? question.correctAnswer ?? question.answer;
    if (expected != null && String(rawSubmitted) === String(expected)) {
      earnedPoints += pts;
      return total + 1;
    }
    return total;
  }, 0);
  const percentage = questions.length > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;
  const summary = { score, total: questions.length };
  Object.defineProperties(summary, {
    earnedPoints: { value: earnedPoints, enumerable: false },
    totalPoints: { value: totalPoints, enumerable: false },
    percentage: { value: percentage, enumerable: false },
  });
  return summary;
}

function createLearnerFeatureRouter({ getStudent, getActor }) {
  const router = express.Router({ mergeParams: true });
  const context = req => ({ student: getStudent(req), actor: getActor(req) });
  const listPublished = (collection, sort = { publishedAt: -1 }) =>
    async (req, res, next) => {
      try {
        const { student } = context(req);
        const data = await getDatabase().collection(collection)
          .find(audience(student)).sort(sort).limit(500).toArray();
        return res.json({ success: true, data });
      } catch (error) { return next(error); }
    };

  router.get('/calendar', listPublished('academicCalendar', { date: 1 }));
  router.get('/events', listPublished('events', { date: 1 }));
  router.post('/events/:eventId/requests', async (req, res, next) => {
    try {
      const { student, actor } = context(req);
      const event = await getDatabase().collection('events').findOne({
        $and: [audience(student), idFilter(req.params.eventId)],
      });
      if (!event) return res.status(404).json({ success: false, error: 'Published event was not found for this student.' });
      const request = {
        id: crypto.randomUUID(),
        ...studentSchoolRecordFields(student),
        eventId: event.id || String(event._id),
        studentId: student.id, branchId: student.branchId,
        requestedByUserId: actor.id, requestedByRole: actor.role,
        status: 'pending', createdAt: new Date(),
      };
      try { await getDatabase().collection('eventRequests').insertOne(request); }
      catch (error) {
        if (error?.code === 11000) return res.status(409).json({ success: false, error: 'An event request already exists.' });
        throw error;
      }
      return res.status(201).json({ success: true, data: request });
    } catch (error) { return next(error); }
  });

  router.get('/ptm', listPublished('ptmSlots', { startsAt: 1 }));
  router.post('/ptm/requests', async (req, res, next) => {
    try {
      const { student, actor } = context(req);
      const teacherId = text(req.body?.teacherId, 120);
      const requestedDate = text(req.body?.date, 30);
      const reason = text(req.body?.reason, 1000);
      if (!teacherId || !requestedDate || !reason || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate))
        return res.status(400).json({ success: false, error: 'teacherId, valid date, and reason are required.' });
      const assignment = await getDatabase().collection('teacherAssignments').findOne({
        ...(studentSchoolFilter(student) || {}),
        teacherUserId: teacherId, branchId: student.branchId,
        ...(student.classId ? { classId: student.classId } : {}),
        status: { $ne: 'revoked' },
      });
      if (!assignment) return res.status(403).json({ success: false, error: 'Teacher is not assigned to this student.' });
      const request = {
        id: crypto.randomUUID(),
        ...studentSchoolRecordFields(student),
        studentId: student.id, branchId: student.branchId,
        teacherUserId: teacherId, requestedDate, reason,
        requestedByUserId: actor.id, requestedByRole: actor.role,
        status: 'pending', createdAt: new Date(),
      };
      await getDatabase().collection('ptmRequests').insertOne(request);
      return res.status(201).json({ success: true, data: request });
    } catch (error) { return next(error); }
  });

  router.get('/resources', async (req, res, next) => {
    try {
      const { student } = context(req);
      const kind = text(req.query.kind, 40);
      const filter = audience(student);
      if (kind) filter.kind = kind;
      const resources = await getDatabase().collection('learningResources')
        .find(filter, { projection: { contentData: 0, answerKey: 0 } })
        .sort({ publishedAt: -1 }).limit(500).toArray();
      const ids = resources.map(item => item.id || String(item._id));
      const progress = ids.length ? await getDatabase().collection('learningProgress')
        .find({ ...(studentSchoolFilter(student) || {}), studentId: student.id, resourceId: { $in: ids } }).toArray() : [];
      return res.json({ success: true, data: resources.map(item => ({
        ...item, progress: progress.find(value => value.resourceId === (item.id || String(item._id))) || null,
      })) });
    } catch (error) { return next(error); }
  });
  router.post('/resources/:resourceId/progress', async (req, res, next) => {
    try {
      const { student, actor } = context(req);
      if (actor.role !== 'student') return res.status(403).json({ success: false, error: 'Only the student can update viewing progress.' });
      const resource = await getDatabase().collection('learningResources').findOne({
        $and: [audience(student), idFilter(req.params.resourceId)],
      });
      if (!resource) return res.status(404).json({ success: false, error: 'Published resource was not found.' });
      const percent = Number(req.body?.percent);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100)
        return res.status(400).json({ success: false, error: 'percent must be between 0 and 100.' });
      const resourceId = resource.id || String(resource._id);
      await getDatabase().collection('learningProgress').updateOne(
        { ...(studentSchoolFilter(student) || {}), studentId: student.id, resourceId },
        {
          $set: {
            ...studentSchoolRecordFields(student),
            ...(student.branchId ? { branchId: student.branchId } : {}),
            percent,
            updatedAt: new Date(),
            completedAt: percent === 100 ? new Date() : null,
          },
        },
        { upsert: true },
      );
      return res.json({ success: true, data: { resourceId, percent } });
    } catch (error) { return next(error); }
  });

  for (const [path, collection] of [['notes', 'studentNotes'], ['flashcards', 'studentFlashcards'], ['revision-planner', 'revisionPlans']]) {
    router.get(`/${path}`, async (req, res, next) => {
      try {
        const { student, actor } = context(req);
        if (actor.role !== 'student') return res.status(403).json({ success: false, error: 'This study workspace belongs to the student.' });
        const data = await getDatabase().collection(collection).find(owned(student, actor)).sort({ updatedAt: -1 }).toArray();
        return res.json({ success: true, data });
      } catch (error) { return next(error); }
    });
    router.post(`/${path}`, async (req, res, next) => {
      try {
        const { student, actor } = context(req);
        if (actor.role !== 'student') return res.status(403).json({ success: false, error: 'This study workspace belongs to the student.' });
        const subject = text(req.body?.subject, 120);
        const title = text(req.body?.title || req.body?.topic, 200);
        const content = text(req.body?.content || req.body?.note || req.body?.answer || req.body?.duration, 10000);
        if (!subject || !title || !content) return res.status(400).json({ success: false, error: 'Subject, title/topic, and content are required.' });
        const item = {
          id: crypto.randomUUID(),
          ...studentSchoolRecordFields(student),
          ...(student.branchId ? { branchId: student.branchId } : {}),
          studentId: student.id,
          actorUserId: actor.id,
          actorRole: actor.role,
          subject,
          title,
          content,
          ...(text(req.body?.studyDate, 30) ? { studyDate: text(req.body.studyDate, 30) } : {}),
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await getDatabase().collection(collection).insertOne(item);
        return res.status(201).json({ success: true, data: item });
      } catch (error) { return next(error); }
    });
  }

  router.get('/quizzes', async (req, res, next) => {
    try {
      const { student } = context(req);
      const data = await getDatabase().collection('quizzes').find(audience(student)).sort({ publishedAt: -1 }).toArray();
      const quizIds = data.map(q => q.id || String(q._id));
      const attempts = quizIds.length
        ? await getDatabase()
            .collection('quizAttempts')
            .find({
              ...(studentSchoolFilter(student) || {}),
              studentId: student.id,
              quizId: { $in: quizIds },
            })
            .sort({ submittedAt: -1 })
            .toArray()
        : [];
      return res.json({
        success: true,
        data: data.map(quiz => {
          const qId = quiz.id || String(quiz._id);
          const quizAttempts = attempts.filter(a => a.quizId === qId);
          return {
            ...safeQuiz(quiz),
            attempts: quizAttempts,
            latestAttempt: quizAttempts[0] || null,
          };
        }),
      });
    } catch (error) { return next(error); }
  });
  router.post('/quizzes/:quizId/attempts', async (req, res, next) => {
    try {
      const { student, actor } = context(req);
      if (actor.role !== 'student') return res.status(403).json({ success: false, error: 'Only the student can submit a quiz attempt.' });
      const quiz = await getDatabase().collection('quizzes').findOne({ $and: [audience(student), idFilter(req.params.quizId)] });
      if (!quiz) return res.status(404).json({ success: false, error: 'Published quiz was not found.' });
      const result = scoreQuiz(quiz, req.body?.answers);
      const attempt = {
        id: crypto.randomUUID(),
        ...studentSchoolRecordFields(student),
        quizId: quiz.id || String(quiz._id),
        ...(quiz.lessonId ? { lessonId: quiz.lessonId } : {}),
        studentId: student.id,
        branchId: student.branchId,
        answers: req.body.answers,
        ...result,
        status: 'scored',
        submittedAt: new Date(),
      };
      await getDatabase().collection('quizAttempts').insertOne(attempt);
      return res.status(201).json({ success: true, data: { id: attempt.id, quizId: attempt.quizId, ...(quiz.lessonId ? { lessonId: quiz.lessonId } : {}), ...result, status: attempt.status } });
    } catch (error) { return next(error); }
  });

  router.get('/documents', listPublished('schoolDocuments', { publishedAt: -1 }));
  router.post('/documents/:documentId/consent', async (req, res, next) => {
    try {
      const { student, actor } = context(req);
      if (actor.role !== 'parent') return res.status(403).json({ success: false, error: 'Parent authorization is required for consent.' });
      const version = text(req.body?.version, 120);
      const decision = text(req.body?.decision, 20);
      if (!version || !['accepted', 'declined'].includes(decision)) return res.status(400).json({ success: false, error: 'Exact version and accepted/declined decision are required.' });
      const document = await getDatabase().collection('schoolDocuments').findOne({ $and: [audience(student), idFilter(req.params.documentId)], version });
      if (!document) return res.status(409).json({ success: false, error: 'The requested published document version is unavailable.' });
      const documentId = document.id || String(document._id);
      const consent = {
        ...studentSchoolRecordFields(student),
        documentId,
        version,
        studentId: student.id,
        parentUserId: actor.id,
        branchId: student.branchId,
        decision,
        decidedAt: new Date(),
      };
      await getDatabase().collection('documentConsents').updateOne(
        { ...(studentSchoolFilter(student) || {}), documentId, version, studentId: student.id, parentUserId: actor.id },
        { $setOnInsert: consent }, { upsert: true },
      );
      return res.status(201).json({ success: true, data: consent });
    } catch (error) { return next(error); }
  });
  router.get('/helpdesk', async (req, res, next) => {
    try {
      const { student, actor } = context(req);
      const data = await getDatabase().collection('helpdeskTickets').find(owned(student, actor)).sort({ createdAt: -1 }).toArray();
      return res.json({ success: true, data });
    } catch (error) { return next(error); }
  });
  router.post('/helpdesk', async (req, res, next) => {
    try {
      const { student, actor } = context(req);
      const category = text(req.body?.category, 100), subject = text(req.body?.subject, 200), message = text(req.body?.message, 5000);
      if (!category || !subject || !message) return res.status(400).json({ success: false, error: 'Category, subject, and message are required.' });
      const ticket = {
        id: crypto.randomUUID(),
        ...studentSchoolRecordFields(student),
        studentId: student.id,
        actorUserId: actor.id,
        actorRole: actor.role,
        branchId: student.branchId,
        category,
        subject,
        message,
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await getDatabase().collection('helpdeskTickets').insertOne(ticket);
      return res.status(201).json({ success: true, data: ticket });
    } catch (error) { return next(error); }
  });

  router.get('/transport/history', async (req, res, next) => {
    try {
      const { student } = context(req);
      const data = await getDatabase().collection('transportEvents').find({
        ...(studentSchoolFilter(student) || {}),
        studentId: student.id,
        branchId: student.branchId,
        providerVerified: true,
      }).sort({ occurredAt: -1 }).limit(500).toArray();
      return res.json({ success: true, data });
    } catch (error) { return next(error); }
  });
  router.get('/transport/tracking', async (req, res, next) => {
    try {
      const { student } = context(req);
      const data = await getDatabase().collection('transportTracking').findOne(
        {
          ...(studentSchoolFilter(student) || {}),
          studentId: student.id,
          branchId: student.branchId,
          providerVerified: true,
          providerEventId: { $type: 'string' },
        },
        { sort: { recordedAt: -1 } },
      );
      if (!data) return res.status(503).json({ success: false, error: 'Verified transport tracking is not available.' });
      return res.json({ success: true, data });
    } catch (error) { return next(error); }
  });

  return router;
}

module.exports = { createLearnerFeatureRouter, __test: { audience, safeQuiz, scoreQuiz } };
