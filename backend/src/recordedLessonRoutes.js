const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const { ObjectId } = require('mongodb');
const { getDatabase } = require('./database');
const { verifiedSchoolDatabase } = require('./schoolAccess');
const { assertTeacherClassAccess, isAssignmentCurrentAndValid } = require('./dlpRoutes');

const STAFF_ROLES = new Set(['teacher', 'principal', 'super_admin']);
const ALL_LEARNER_AND_STAFF_ROLES = new Set(['teacher', 'principal', 'super_admin', 'student', 'parent']);
const MAX_RETRIES = 3;
const DEFAULT_RETENTION_DAYS = 180;
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

const uploadMedia = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MEDIA_BYTES, files: 1, fields: 20 },
});

function httpError(message, statusCode = 400, code = undefined) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.code = code;
  return err;
}

function cleanText(value, label, maxLen = 4000, optional = false) {
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

function validateMediaBuffer(buffer, originalName = 'lesson-recording.mp4', declaredMime = '') {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    throw httpError('Uploaded media file must be a valid non-empty audio/video binary.', 400);
  }
  if (buffer.length > MAX_MEDIA_BYTES) {
    throw httpError('Uploaded media file exceeds the 25 MB limit.', 413);
  }

  const ext = path.extname(String(originalName || '')).toLowerCase();
  const isMp4OrM4a =
    (ext === '.mp4' || ext === '.m4a' || declaredMime === 'video/mp4' || declaredMime === 'audio/mp4') &&
    buffer.subarray(4, 8).toString('ascii') === 'ftyp';
  const isWebm =
    (ext === '.webm' || declaredMime === 'video/webm' || declaredMime === 'audio/webm') &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3;
  const isWav =
    (ext === '.wav' || declaredMime === 'audio/wav' || declaredMime === 'audio/x-wav') &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WAVE';
  const isMp3 =
    (ext === '.mp3' || declaredMime === 'audio/mpeg') &&
    (buffer.subarray(0, 3).toString('ascii') === 'ID3' ||
      (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0));

  if (!isMp4OrM4a && !isWebm && !isWav && !isMp3) {
    throw httpError(
      'Media file signature, extension, and MIME type must match MP4, WebM, WAV, or MP3.',
      400,
    );
  }

  const contentType = isMp4OrM4a
    ? ext === '.m4a' || declaredMime === 'audio/mp4'
      ? 'audio/mp4'
      : 'video/mp4'
    : isWebm
    ? declaredMime === 'audio/webm'
      ? 'audio/webm'
      : 'video/webm'
    : isWav
    ? 'audio/wav'
    : 'audio/mpeg';

  const defaultExt = isMp4OrM4a ? '.mp4' : isWebm ? '.webm' : isWav ? '.wav' : '.mp3';
  const safeFileName =
    path
      .basename(String(originalName || `lesson${defaultExt}`).replace(/\\/g, '/'))
      .replace(/[\r\n\0"]/g, '_')
      .slice(0, 140) || `lesson${defaultExt}`;

  return { contentType, safeFileName, byteLength: buffer.length };
}

function extractUploadedMedia(req) {
  if (req.file && Buffer.isBuffer(req.file.buffer)) {
    const meta = validateMediaBuffer(req.file.buffer, req.file.originalname, req.file.mimetype);
    return { buffer: req.file.buffer, ...meta };
  }
  if (typeof req.body?.mediaBase64 === 'string' && req.body.mediaBase64.trim()) {
    const raw = req.body.mediaBase64.trim().replace(/^data:[^;]+;base64,/, '');
    if (!/^[A-Za-z0-9+/=]+$/.test(raw)) {
      throw httpError('mediaBase64 must be valid base64-encoded binary data.', 400);
    }
    const buffer = Buffer.from(raw, 'base64');
    const meta = validateMediaBuffer(
      buffer,
      req.body?.mediaFileName || 'lesson.mp4',
      req.body?.mediaContentType || 'video/mp4',
    );
    return { buffer, ...meta };
  }
  if (req.body?.mediaUrl !== undefined && req.body?.mediaUrl !== null && String(req.body.mediaUrl).trim() !== '') {
    throw httpError(
      'Fake or unverified external media URLs (such as storage://...) are not permitted. Upload a validated audio/video file or omit mediaUrl for transcript-only drafts.',
      400,
    );
  }
  return null;
}

function validateQuizQuestions(questions) {
  if (!Array.isArray(questions) || questions.length > 25) {
    throw httpError('Quiz questions must be an array of up to 25 items.');
  }
  return questions.map((q, index) => {
    const prompt = cleanText(q?.prompt || q?.question, `Question ${index + 1} prompt`, 600);
    const options = Array.isArray(q?.options)
      ? q.options.map((opt, idx) => cleanText(opt, `Question ${index + 1} option ${idx + 1}`, 300))
      : [];
    if (options.length < 2 || options.length > 6) {
      throw httpError(`Question ${index + 1} must provide 2 to 6 options.`);
    }
    const correctOption = Number(q?.correctOption ?? 0);
    if (!Number.isInteger(correctOption) || correctOption < 0 || correctOption >= options.length) {
      throw httpError(`Question ${index + 1} requires a valid correctOption index.`);
    }
    return {
      id: q?.id || `q-${index + 1}`,
      prompt,
      options,
      correctOption,
      points: Math.max(1, Math.min(20, Number(q?.points) || 1)),
    };
  });
}

async function defaultGeminiAiAdapter({ title, subject, transcriptText }) {
  if (process.env.RECORDED_LESSONS_AI_ENABLED === 'false') {
    throw httpError(
      'Recorded lesson AI draft generation is disabled in server configuration.',
      503,
      'AI_CONFIGURATION_REQUIRED',
    );
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (
    !apiKey ||
    apiKey === 'MY_GEMINI_API_KEY' ||
    apiKey === 'PLACEHOLDER_API_KEY' ||
    !apiKey.trim()
  ) {
    throw httpError(
      'Server-side GEMINI_API_KEY is not configured. AI draft generation is unavailable until configured.',
      503,
      'AI_CONFIGURATION_REQUIRED',
    );
  }

  const { GoogleGenAI, Type } = require('@google/genai');
  const ai = new GoogleGenAI({
    apiKey: apiKey.trim(),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `You are an expert school curriculum assistant. Based ONLY on the following recorded lesson transcript for "${title}" (${subject}), generate a draft lesson summary, structured revision notes, and 3 multiple-choice quiz questions for Teacher review before student publication.\n\nTranscript:\n${transcriptText}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: {
            type: Type.STRING,
            description: 'Concise 2-4 sentence summary of the recorded lesson.',
          },
          revisionNotes: {
            type: Type.STRING,
            description: 'Bullet-style key revision notes and formulas covered in the lesson.',
          },
          quizQuestions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                prompt: { type: Type.STRING },
                options: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                correctOption: { type: Type.INTEGER },
              },
              required: ['prompt', 'options', 'correctOption'],
            },
          },
        },
        required: ['summary', 'revisionNotes', 'quizQuestions'],
      },
    },
  });

  const rawText = response.text;
  if (!rawText) {
    throw httpError('AI model returned an empty draft response.', 502);
  }

  const parsed = JSON.parse(rawText.trim());
  return {
    summary: cleanText(parsed.summary, 'AI draft summary', 4000),
    revisionNotes: cleanText(parsed.revisionNotes, 'AI revision notes', 6000),
    quizQuestions: validateQuizQuestions(parsed.quizQuestions || []),
  };
}

async function resolvePersistedUser(db, reqUser, fallbackActor) {
  const userId = String(reqUser?.id || fallbackActor?.id || fallbackActor?._id || '').trim();
  if (!userId) {
    throw httpError('Authentication is required.', 401);
  }
  const persisted = await db.collection('users').findOne({
    $or: buildIdCandidates(userId),
  });
  if (!persisted) {
    throw httpError('Persisted active user account is required.', 403);
  }
  if (persisted.active === false || persisted.isActive === false || persisted.status === 'suspended') {
    throw httpError('User account is inactive or suspended.', 403);
  }
  if (persisted.role !== reqUser.role) {
    throw httpError('User role authorization has changed.', 403);
  }
  return persisted;
}

async function resolveStaffScope(req, database) {
  if (!req.user?.id || !req.user?.role) {
    throw httpError('Authentication is required.', 401);
  }
  if (!STAFF_ROLES.has(req.user.role)) {
    throw httpError('Academic staff authority is required to manage recorded lessons.', 403);
  }
  const db = database();
  const persisted = await resolvePersistedUser(db, req.user, req.authenticatedUserRecord);
  if (!persisted.schoolId) {
    throw httpError('The account needs a verified school mapping before managing recorded lessons.', 503);
  }
  const scopedDb = await verifiedSchoolDatabase(db, persisted);
  const branchId = persisted.branchId ? String(persisted.branchId) : null;
  if (req.user.role !== 'super_admin' && !branchId) {
    throw httpError('Branch assignment is required for recorded lesson management.', 403);
  }
  if (branchId) {
    const branch = await scopedDb.collection('branches').findOne({
      $or: buildIdCandidates(branchId),
    });
    if (!branch || branch.active === false || branch.isActive === false) {
      throw httpError('Active branch assignment in the same school is required.', 403);
    }
  }
  const canonicalUserId = String(persisted.id || persisted._id);
  return {
    db,
    scopedDb,
    actor: persisted,
    userId: canonicalUserId,
    actorIds: new Set(
      [String(req.user.id), String(persisted.id || ''), String(persisted._id || '')].filter(Boolean),
    ),
    role: persisted.role,
    schoolId: String(persisted.schoolId),
    branchId,
  };
}

function isLessonExpired(lesson, now = new Date()) {
  if (!lesson?.retentionExpiresAt) return false;
  const expires = new Date(lesson.retentionExpiresAt);
  return Number.isFinite(expires.getTime()) && expires.getTime() <= now.getTime();
}

function createRecordedLessonRouter({
  database = getDatabase,
  aiAdapter = defaultGeminiAiAdapter,
  transcriptionAdapter = null,
} = {}) {
  const router = express.Router();

  // List staff recorded lessons (includes drafts, AI jobs, and published items; filters out expired retention)
  router.get('/', async (req, res) => {
    try {
      const scope = await resolveStaffScope(req, database);
      const filter = {};
      if (scope.branchId) filter.branchId = scope.branchId;
      if (typeof req.query?.classId === 'string' && req.query.classId.trim()) {
        filter.classId = req.query.classId.trim();
      }
      if (typeof req.query?.section === 'string' && req.query.section.trim()) {
        filter.section = req.query.section.trim();
      }
      if (typeof req.query?.status === 'string' && req.query.status.trim()) {
        filter.status = req.query.status.trim();
      }

      let activePairs = null;
      if (scope.role === 'teacher') {
        const [lowerAssign, camelAssign] = await Promise.all([
          scope.scopedDb.collection('teacherassignments').find({}).limit(500).toArray(),
          scope.scopedDb.collection('teacherAssignments').find({}).limit(500).toArray(),
        ]);
        const now = new Date();
        const myAssignments = [...lowerAssign, ...camelAssign].filter(
          a =>
            scope.actorIds.has(String(a.teacherId ?? a.teacherUserId ?? '')) &&
            String(a.branchId) === String(scope.branchId) &&
            isAssignmentCurrentAndValid(a, now),
        );
        if (myAssignments.length === 0) {
          throw httpError('Teacher has no active class assignments for recorded lessons.', 403);
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

      const now = new Date();
      const items = await scope.scopedDb
        .collection('recordedLessons')
        .find(filter)
        .sort({ updatedAt: -1 })
        .limit(100)
        .toArray();

      const visible = items.filter(item => {
        if (item.deletedAt || isLessonExpired(item, now)) return false;
        if (scope.role === 'teacher') {
          return (
            scope.actorIds.has(String(item.teacherUserId)) &&
            activePairs.has(`${String(item.classId).trim()}::${String(item.section).trim()}`)
          );
        }
        return true;
      });

      return res.json({ success: true, data: visible });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Unable to load recorded lessons.',
      });
    }
  });

  // Step 1: Upload / register a recorded lesson with validated media binary and/or transcript
  router.post('/', uploadMedia.single('media'), async (req, res) => {
    try {
      const scope = await resolveStaffScope(req, database);
      if (!['teacher', 'principal'].includes(scope.role)) {
        throw httpError('Only Teachers or Principals can upload recorded lessons.', 403);
      }
      const title = cleanText(req.body?.title, 'Lesson title', 180);
      const subject = cleanText(req.body?.subject, 'Subject', 120);
      const classId = cleanText(req.body?.classId, 'Class ID', 80);
      if (req.body?.section === undefined || req.body?.section === null || !String(req.body.section).trim()) {
        throw httpError('Section is required and cannot be defaulted.', 400);
      }
      const section = cleanText(req.body.section, 'Section', 40);
      const grade = cleanText(req.body?.grade || classId, 'Grade', 60, true);
      const chapter = cleanText(req.body?.chapter, 'Chapter', 140, true);
      const topic = cleanText(req.body?.topic, 'Topic', 180, true);

      // Enforce current active Teacher assignment for target class & section
      await assertTeacherClassAccess(scope.scopedDb, scope, classId, section);

      const uploadedMedia = extractUploadedMedia(req);
      const transcriptText = cleanText(req.body?.transcriptText, 'Lesson transcript or recording notes', 12000, Boolean(uploadedMedia));
      if (!uploadedMedia && !transcriptText) {
        throw httpError(
          'Provide either a validated audio/video recording file or a lesson transcript.',
          400,
        );
      }

      const durationSeconds = Math.max(10, Math.min(14400, Number(req.body?.durationSeconds) || 900));
      const retentionDays = Math.max(1, Math.min(3650, Number(req.body?.retentionDays) || DEFAULT_RETENTION_DAYS));
      const now = new Date();
      const expiresAt = new Date(now.getTime() + retentionDays * 86400_000);
      const lessonId = crypto.randomUUID();

      let mediaMetadata = null;
      if (uploadedMedia) {
        const mediaId = crypto.randomUUID();
        await scope.scopedDb.collection('recordedLessonMedia').insertOne({
          id: mediaId,
          lessonId,
          branchId: scope.branchId,
          sourceVersion: 1,
          fileName: uploadedMedia.safeFileName,
          contentType: uploadedMedia.contentType,
          byteLength: uploadedMedia.byteLength,
          data: uploadedMedia.buffer,
          uploadedByUserId: scope.userId,
          createdAt: now,
        });
        mediaMetadata = {
          mediaId,
          fileName: uploadedMedia.safeFileName,
          contentType: uploadedMedia.contentType,
          byteLength: uploadedMedia.byteLength,
          playbackPath: `/api/recorded-lessons/${lessonId}/media`,
        };
      }

      const initialJobStatus = transcriptText ? 'transcribed' : 'queued';

      const lesson = {
        id: lessonId,
        branchId: scope.branchId,
        teacherUserId: scope.userId,
        teacherName: scope.actor?.fullName || scope.actor?.name || 'Teacher',
        title,
        subject,
        classId,
        section,
        ...(grade ? { grade } : {}),
        ...(chapter ? { chapter } : {}),
        ...(topic ? { topic } : {}),
        mediaStatus: mediaMetadata ? 'stored_verified' : 'transcript_only',
        media: mediaMetadata,
        mediaPlaybackPath: mediaMetadata ? mediaMetadata.playbackPath : null,
        durationSeconds,
        transcriptText: transcriptText || '',
        sourceVersion: 1,
        jobStatus: initialJobStatus,
        retryCount: 0,
        lastJobError: null,
        aiDraft: null,
        reviewedMaterial: null,
        teacherReviewed: false,
        reviewedSourceVersion: null,
        teacherReviewedBy: null,
        teacherReviewedAt: null,
        published: false,
        status: 'draft_uploaded',
        retentionDays,
        retentionExpiresAt: expiresAt,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      await scope.scopedDb.collection('recordedLessons').insertOne(lesson);
      return res.status(201).json({ success: true, data: lesson });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Unable to create recorded lesson.',
      });
    }
  });

  // Protected media playback/download endpoint for eligible staff, students, and verified parents
  router.get('/:lessonId/media', async (req, res) => {
    try {
      if (!req.user?.id || !req.user?.role || !ALL_LEARNER_AND_STAFF_ROLES.has(req.user.role)) {
        return res.status(401).json({ success: false, error: 'Authentication is required.' });
      }
      const db = database();
      const persisted = await resolvePersistedUser(db, req.user, req.authenticatedUserRecord);
      if (!persisted.schoolId) {
        return res.status(503).json({ success: false, error: 'Verified school mapping is required.' });
      }
      const scopedDb = await verifiedSchoolDatabase(db, persisted);
      const lesson = await scopedDb.collection('recordedLessons').findOne({
        id: String(req.params.lessonId),
      });
      if (!lesson || lesson.deletedAt) {
        return res.status(404).json({ success: false, error: 'Recorded lesson was not found.' });
      }
      if (isLessonExpired(lesson, new Date())) {
        return res.status(410).json({
          success: false,
          error: 'Recorded lesson media has expired under the school retention policy.',
        });
      }

      if (STAFF_ROLES.has(persisted.role)) {
        const scope = await resolveStaffScope(req, database);
        if (scope.branchId && String(lesson.branchId) !== String(scope.branchId)) {
          return res.status(403).json({ success: false, error: 'Cross-branch media access is denied.' });
        }
        if (scope.role === 'teacher') {
          await assertTeacherClassAccess(scopedDb, scope, lesson.classId, lesson.section);
        }
      } else if (persisted.role === 'student') {
        if (lesson.published !== true || lesson.status !== 'published') {
          return res.status(403).json({ success: false, error: 'Recorded lesson is not published.' });
        }
        const student = await scopedDb.collection('students').findOne({
          $or: [
            { userId: String(persisted.id || persisted._id) },
            { userId: String(persisted._id || '') },
            { id: String(persisted.studentId || '') },
          ],
        });
        if (
          !student ||
          String(student.branchId) !== String(lesson.branchId) ||
          String(student.classId) !== String(lesson.classId) ||
          (student.section && String(student.section) !== String(lesson.section))
        ) {
          return res.status(403).json({
            success: false,
            error: 'Student is not enrolled in the class/section for this recorded lesson.',
          });
        }
      } else if (persisted.role === 'parent') {
        if (lesson.published !== true || lesson.status !== 'published') {
          return res.status(403).json({ success: false, error: 'Recorded lesson is not published.' });
        }
        const links = await scopedDb
          .collection('parentChildLinks')
          .find({
            parentUserId: { $in: [String(persisted.id || ''), String(persisted._id || '')].filter(Boolean) },
            status: 'verified',
            revokedAt: null,
          })
          .limit(50)
          .toArray();
        const studentIds = links.map(l => String(l.studentId)).filter(Boolean);
        const child = studentIds.length
          ? await scopedDb.collection('students').findOne({
              id: { $in: studentIds },
              branchId: lesson.branchId,
              classId: lesson.classId,
              ...(lesson.section ? { section: lesson.section } : {}),
            })
          : null;
        if (!child) {
          return res.status(403).json({
            success: false,
            error: 'No verified linked child belongs to the class/section for this recorded lesson.',
          });
        }
      }

      if (!lesson.media?.mediaId) {
        return res.status(404).json({
          success: false,
          error: 'No audio/video media binary is attached to this recorded lesson.',
        });
      }

      const mediaDoc = await scopedDb.collection('recordedLessonMedia').findOne({
        id: lesson.media.mediaId,
        lessonId: lesson.id,
      });
      if (!mediaDoc || !mediaDoc.data) {
        return res.status(404).json({
          success: false,
          error: 'Recorded lesson media binary is unavailable.',
        });
      }

      const rawBuffer = Buffer.isBuffer(mediaDoc.data)
        ? mediaDoc.data
        : Buffer.from(mediaDoc.data.buffer || mediaDoc.data);

      res.setHeader('Content-Type', mediaDoc.contentType || 'video/mp4');
      res.setHeader('Content-Length', String(rawBuffer.length));
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${String(mediaDoc.fileName || 'lesson.mp4').replace(/"/g, '')}"`,
      );
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).send(rawBuffer);
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Unable to stream recorded lesson media.',
      });
    }
  });

  // Update source recording/transcript -> bumps sourceVersion and invalidates unreviewed publication
  router.patch('/:lessonId/source', uploadMedia.single('media'), async (req, res) => {
    try {
      const scope = await resolveStaffScope(req, database);
      const existing = await scope.scopedDb.collection('recordedLessons').findOne({
        id: String(req.params.lessonId),
        branchId: scope.branchId,
      });
      if (!existing || existing.deletedAt) {
        return res.status(404).json({ success: false, error: 'Recorded lesson was not found.' });
      }
      if (scope.role === 'teacher' && !scope.actorIds.has(String(existing.teacherUserId))) {
        throw httpError('Teachers may only update their own recorded lessons.', 403);
      }

      await assertTeacherClassAccess(scope.scopedDb, scope, existing.classId, existing.section);

      const uploadedMedia = extractUploadedMedia(req);
      const transcriptText =
        req.body?.transcriptText !== undefined
          ? cleanText(req.body.transcriptText, 'Transcript text', 12000, Boolean(uploadedMedia))
          : existing.transcriptText;

      const nextVersion = Number(existing.sourceVersion || 1) + 1;
      const now = new Date();
      let mediaMetadata = existing.media || null;

      if (uploadedMedia) {
        const mediaId = crypto.randomUUID();
        await scope.scopedDb.collection('recordedLessonMedia').insertOne({
          id: mediaId,
          lessonId: existing.id,
          branchId: scope.branchId,
          sourceVersion: nextVersion,
          fileName: uploadedMedia.safeFileName,
          contentType: uploadedMedia.contentType,
          byteLength: uploadedMedia.byteLength,
          data: uploadedMedia.buffer,
          uploadedByUserId: scope.userId,
          createdAt: now,
        });
        mediaMetadata = {
          mediaId,
          fileName: uploadedMedia.safeFileName,
          contentType: uploadedMedia.contentType,
          byteLength: uploadedMedia.byteLength,
          playbackPath: `/api/recorded-lessons/${existing.id}/media`,
        };
      }

      await scope.scopedDb.collection('recordedLessons').updateOne(
        { id: existing.id },
        {
          $set: {
            transcriptText,
            media: mediaMetadata,
            mediaStatus: mediaMetadata ? 'stored_verified' : 'transcript_only',
            mediaPlaybackPath: mediaMetadata ? mediaMetadata.playbackPath : null,
            sourceVersion: nextVersion,
            jobStatus: transcriptText ? 'transcribed' : 'queued',
            retryCount: 0,
            lastJobError: null,
            aiDraft: null,
            reviewedMaterial: null,
            teacherReviewed: false,
            reviewedSourceVersion: null,
            published: false,
            status: 'source_updated_review_required',
            updatedAt: now,
          },
        },
      );
      const updated = await scope.scopedDb.collection('recordedLessons').findOne({ id: existing.id });
      return res.json({ success: true, data: updated });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Unable to update recorded lesson source.',
      });
    }
  });

  // Explicit transcription job transition (queued -> processing -> transcribed / failed)
  router.post('/:lessonId/transcribe', async (req, res) => {
    try {
      const scope = await resolveStaffScope(req, database);
      const lesson = await scope.scopedDb.collection('recordedLessons').findOne({
        id: String(req.params.lessonId),
        branchId: scope.branchId,
      });
      if (!lesson || lesson.deletedAt) {
        return res.status(404).json({ success: false, error: 'Recorded lesson was not found.' });
      }
      if (scope.role === 'teacher' && !scope.actorIds.has(String(lesson.teacherUserId))) {
        throw httpError('Teachers may only transcribe their own recorded lessons.', 403);
      }
      await assertTeacherClassAccess(scope.scopedDb, scope, lesson.classId, lesson.section);

      const startVersion = Number(lesson.sourceVersion || 1);
      await scope.scopedDb.collection('recordedLessons').updateOne(
        { id: lesson.id, sourceVersion: startVersion },
        { $set: { jobStatus: 'processing', updatedAt: new Date() } },
      );

      let resolvedTranscript =
        typeof req.body?.transcriptText === 'string' && req.body.transcriptText.trim()
          ? cleanText(req.body.transcriptText, 'Transcript text', 12000)
          : '';

      if (!resolvedTranscript && typeof transcriptionAdapter === 'function') {
        resolvedTranscript = await transcriptionAdapter(lesson);
      }

      if (!resolvedTranscript) {
        await scope.scopedDb.collection('recordedLessons').updateOne(
          { id: lesson.id, sourceVersion: startVersion },
          {
            $set: {
              jobStatus: 'failed',
              lastJobError: 'Transcription text or configured transcription service is required.',
              updatedAt: new Date(),
            },
          },
        );
        return res.status(503).json({
          success: false,
          code: 'TRANSCRIPTION_UNAVAILABLE',
          error: 'Transcription service is not configured and no transcript text was supplied.',
        });
      }

      const updateRes = await scope.scopedDb.collection('recordedLessons').updateOne(
        { id: lesson.id, sourceVersion: startVersion },
        {
          $set: {
            transcriptText: resolvedTranscript,
            jobStatus: 'transcribed',
            lastJobError: null,
            updatedAt: new Date(),
          },
        },
      );
      if (!updateRes.matchedCount) {
        return res.status(409).json({
          success: false,
          error: 'Source recording changed while transcription was in progress; stale transcription discarded.',
        });
      }
      const updated = await scope.scopedDb.collection('recordedLessons').findOne({ id: lesson.id });
      return res.json({ success: true, data: updated });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Unable to transcribe recorded lesson.',
      });
    }
  });

  // Step 2: Process / Generate AI Draft Summary, Revision Notes & Quiz (Server-Side Gemini AI with sourceVersion fencing)
  router.post('/:lessonId/process-ai', async (req, res) => {
    try {
      const scope = await resolveStaffScope(req, database);
      const lesson = await scope.scopedDb.collection('recordedLessons').findOne({
        id: String(req.params.lessonId),
        branchId: scope.branchId,
      });
      if (!lesson || lesson.deletedAt) {
        return res.status(404).json({ success: false, error: 'Recorded lesson was not found.' });
      }
      if (isLessonExpired(lesson, new Date())) {
        throw httpError('Recorded lesson has expired under the retention policy.', 410);
      }
      if (scope.role === 'teacher' && !scope.actorIds.has(String(lesson.teacherUserId))) {
        throw httpError('Teachers may only run AI processing on their own recorded lessons.', 403);
      }
      await assertTeacherClassAccess(scope.scopedDb, scope, lesson.classId, lesson.section);

      if (!lesson.transcriptText || !String(lesson.transcriptText).trim()) {
        throw httpError('Recorded lesson must be transcribed before generating an AI draft.', 409);
      }

      if (Number(lesson.retryCount || 0) >= MAX_RETRIES && req.body?.resetRetries !== true) {
        throw httpError('Maximum AI processing retries reached for this source version.', 429);
      }

      // Capture exact sourceVersion BEFORE calling AI so stale AI responses cannot overwrite newer sourceVersions
      const startVersion = Number(lesson.sourceVersion || 1);
      const nextRetryCount = req.body?.resetRetries === true ? 1 : Number(lesson.retryCount || 0) + 1;

      await scope.scopedDb.collection('recordedLessons').updateOne(
        { id: lesson.id, sourceVersion: startVersion },
        {
          $set: {
            jobStatus: 'processing',
            retryCount: nextRetryCount,
            updatedAt: new Date(),
          },
        },
      );

      try {
        const draft = await aiAdapter({
          title: lesson.title,
          subject: lesson.subject,
          transcriptText: lesson.transcriptText,
          sourceVersion: startVersion,
        });
        const now = new Date();
        const aiDraft = {
          summary: draft.summary,
          revisionNotes: draft.revisionNotes,
          quizQuestions: draft.quizQuestions,
          generatedForVersion: startVersion,
          generatedAt: now,
        };

        // Conditional update fenced on sourceVersion === startVersion
        const updateRes = await scope.scopedDb.collection('recordedLessons').updateOne(
          { id: lesson.id, sourceVersion: startVersion },
          {
            $set: {
              aiDraft,
              jobStatus: 'ai_draft_ready',
              status: 'pending_teacher_review',
              retryCount: nextRetryCount,
              lastJobError: null,
              teacherReviewed: false,
              published: false,
              updatedAt: now,
            },
          },
        );
        if (!updateRes.matchedCount) {
          return res.status(409).json({
            success: false,
            code: 'STALE_SOURCE_VERSION',
            error:
              'Source recording or transcript was updated while AI draft generation was in progress; stale AI response was discarded.',
          });
        }
        const updated = await scope.scopedDb.collection('recordedLessons').findOne({ id: lesson.id });
        return res.json({ success: true, data: updated });
      } catch (aiError) {
        const isConfigMissing = aiError.code === 'AI_CONFIGURATION_REQUIRED' || aiError.statusCode === 503;
        await scope.scopedDb.collection('recordedLessons').updateOne(
          { id: lesson.id, sourceVersion: startVersion },
          {
            $set: {
              jobStatus: isConfigMissing ? 'ai_configuration_required' : 'failed',
              lastJobError: aiError.message || 'AI draft generation failed.',
              retryCount: nextRetryCount,
              updatedAt: new Date(),
            },
          },
        );
        return res.status(aiError.statusCode || 502).json({
          success: false,
          code: aiError.code || 'AI_PROCESSING_FAILED',
          error: aiError.message || 'AI draft generation failed.',
        });
      }
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Unable to process AI draft.',
      });
    }
  });

  // Step 3: Teacher Review, Edit & Approval (Mandatory before publication)
  router.post('/:lessonId/review', async (req, res) => {
    try {
      const scope = await resolveStaffScope(req, database);
      if (!['teacher', 'principal'].includes(scope.role)) {
        throw httpError('Only a Teacher or Principal can review and approve lesson materials.', 403);
      }
      const lesson = await scope.scopedDb.collection('recordedLessons').findOne({
        id: String(req.params.lessonId),
        branchId: scope.branchId,
      });
      if (!lesson || lesson.deletedAt) {
        return res.status(404).json({ success: false, error: 'Recorded lesson was not found.' });
      }
      if (scope.role === 'teacher' && !scope.actorIds.has(String(lesson.teacherUserId))) {
        throw httpError('Teachers may only review their own recorded lessons.', 403);
      }
      await assertTeacherClassAccess(scope.scopedDb, scope, lesson.classId, lesson.section);

      if (req.body?.approved !== true) {
        throw httpError('Explicit Teacher approval (approved: true) is required.');
      }

      const expectedVersion =
        req.body?.sourceVersion !== undefined ? Number(req.body.sourceVersion) : Number(lesson.sourceVersion);
      if (expectedVersion !== Number(lesson.sourceVersion)) {
        return res.status(409).json({
          success: false,
          error: 'Lesson source version changed; refresh and review the latest version.',
        });
      }

      const summary = cleanText(
        req.body?.summary ?? lesson.aiDraft?.summary,
        'Reviewed lesson summary',
        4000,
      );
      const revisionNotes = cleanText(
        req.body?.revisionNotes ?? lesson.aiDraft?.revisionNotes,
        'Reviewed revision notes',
        6000,
      );
      const quizQuestions = validateQuizQuestions(
        req.body?.quizQuestions ?? lesson.aiDraft?.quizQuestions ?? [],
      );

      const now = new Date();
      const reviewedMaterial = {
        summary,
        revisionNotes,
        quizQuestions,
        sourceVersion: lesson.sourceVersion,
        approvedByUserId: scope.userId,
        approvedAt: now,
      };

      const updateRes = await scope.scopedDb.collection('recordedLessons').updateOne(
        { id: lesson.id, sourceVersion: lesson.sourceVersion },
        {
          $set: {
            reviewedMaterial,
            summary,
            revisionNotes,
            teacherReviewed: true,
            reviewedSourceVersion: lesson.sourceVersion,
            teacherReviewedBy: scope.userId,
            teacherReviewedAt: now,
            jobStatus: 'teacher_approved',
            status: 'approved_ready_to_publish',
            updatedAt: now,
          },
        },
      );
      if (!updateRes.matchedCount) {
        return res.status(409).json({
          success: false,
          error: 'Lesson source version changed during review; review was not saved.',
        });
      }

      const updated = await scope.scopedDb.collection('recordedLessons').findOne({ id: lesson.id });
      return res.json({ success: true, data: updated });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Unable to save Teacher review.',
      });
    }
  });

  // Step 4: Publish to eligible Students (Strictly requires Teacher approval on current sourceVersion)
  router.post('/:lessonId/publish', async (req, res) => {
    try {
      const scope = await resolveStaffScope(req, database);
      if (!['teacher', 'principal'].includes(scope.role)) {
        throw httpError('Only a Teacher or Principal can publish recorded lessons.', 403);
      }
      const lesson = await scope.scopedDb.collection('recordedLessons').findOne({
        id: String(req.params.lessonId),
        branchId: scope.branchId,
      });
      if (!lesson || lesson.deletedAt) {
        return res.status(404).json({ success: false, error: 'Recorded lesson was not found.' });
      }
      if (isLessonExpired(lesson, new Date())) {
        throw httpError('Recorded lesson has expired under the retention policy and cannot be published.', 410);
      }
      if (scope.role === 'teacher' && !scope.actorIds.has(String(lesson.teacherUserId))) {
        throw httpError('Teachers may only publish their own recorded lessons.', 403);
      }
      await assertTeacherClassAccess(scope.scopedDb, scope, lesson.classId, lesson.section);

      if (
        lesson.teacherReviewed !== true ||
        lesson.reviewedSourceVersion !== lesson.sourceVersion ||
        !lesson.reviewedMaterial
      ) {
        return res.status(409).json({
          success: false,
          error:
            'Recorded lesson and AI draft materials must be reviewed and approved by the teacher for the current source version before publication.',
        });
      }

      const now = new Date();
      const pubRes = await scope.scopedDb.collection('recordedLessons').updateOne(
        {
          id: lesson.id,
          sourceVersion: lesson.sourceVersion,
          reviewedSourceVersion: lesson.sourceVersion,
        },
        {
          $set: {
            published: true,
            status: 'published',
            publishedAt: now,
            publishedVersion: lesson.sourceVersion,
            publishedByUserId: scope.userId,
            updatedAt: now,
          },
        },
      );
      if (!pubRes.matchedCount) {
        return res.status(409).json({
          success: false,
          error: 'Source version changed before publication could complete.',
        });
      }

      // Sync to `learningResources` so Student/Parent `/features/resources` sees the approved recorded lesson
      const resourceId = `resource-lesson-${lesson.id}`;
      const existingResource = await scope.scopedDb.collection('learningResources').findOne({ id: resourceId });
      const resourcePayload = {
        id: resourceId,
        lessonId: lesson.id,
        kind: 'recorded_lesson',
        branchId: lesson.branchId,
        classId: lesson.classId,
        section: lesson.section,
        title: lesson.title,
        subject: lesson.subject,
        ...(lesson.chapter ? { chapter: lesson.chapter } : {}),
        ...(lesson.topic ? { topic: lesson.topic } : {}),
        summary: lesson.reviewedMaterial.summary,
        revisionNotes: lesson.reviewedMaterial.revisionNotes,
        mediaPlaybackPath: lesson.mediaPlaybackPath || null,
        durationSeconds: lesson.durationSeconds,
        sourceVersion: lesson.sourceVersion,
        published: true,
        status: 'published',
        publishedAt: now,
        updatedAt: now,
      };
      if (existingResource) {
        await scope.scopedDb.collection('learningResources').updateOne(
          { id: resourceId },
          { $set: resourcePayload },
        );
      } else {
        await scope.scopedDb.collection('learningResources').insertOne({
          ...resourcePayload,
          createdAt: now,
        });
      }

      // If approved quiz questions exist, also publish/update the corresponding class quiz for Students
      let publishedQuizId = null;
      if (Array.isArray(lesson.reviewedMaterial.quizQuestions) && lesson.reviewedMaterial.quizQuestions.length > 0) {
        publishedQuizId = `quiz-lesson-${lesson.id}-v${lesson.sourceVersion}`;
        const existingQuiz = await scope.scopedDb.collection('quizzes').findOne({ id: publishedQuizId });
        if (!existingQuiz) {
          await scope.scopedDb.collection('quizzes').insertOne({
            id: publishedQuizId,
            lessonId: lesson.id,
            sourceVersion: lesson.sourceVersion,
            branchId: lesson.branchId,
            classId: lesson.classId,
            section: lesson.section,
            ...(lesson.grade ? { grade: lesson.grade } : {}),
            ...(lesson.chapter ? { chapter: lesson.chapter } : {}),
            ...(lesson.topic ? { topic: lesson.topic } : {}),
            title: `${lesson.title} — Revision Quiz`,
            subject: lesson.subject,
            questions: lesson.reviewedMaterial.quizQuestions,
            published: true,
            status: 'published',
            publishedAt: now,
            createdAt: now,
          });
        }
      }

      const updated = await scope.scopedDb.collection('recordedLessons').findOne({ id: lesson.id });
      return res.json({
        success: true,
        data: {
          lesson: updated,
          publishedQuizId,
        },
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Unable to publish recorded lesson.',
      });
    }
  });

  // Step 5: Student playback progress tracking on a published recorded lesson
  router.post('/:lessonId/progress', async (req, res) => {
    try {
      if (!req.user?.id || req.user?.role !== 'student') {
        return res.status(403).json({ success: false, error: 'Only an enrolled Student can record lesson playback progress.' });
      }
      const db = database();
      const persisted = await resolvePersistedUser(db, req.user, req.authenticatedUserRecord);
      if (!persisted.schoolId) {
        return res.status(503).json({ success: false, error: 'Verified school mapping is required.' });
      }
      const scopedDb = await verifiedSchoolDatabase(db, persisted);
      const lesson = await scopedDb.collection('recordedLessons').findOne({ id: String(req.params.lessonId) });
      if (!lesson || lesson.deletedAt) {
        return res.status(404).json({ success: false, error: 'Recorded lesson was not found.' });
      }
      if (lesson.published !== true || lesson.status !== 'published') {
        return res.status(403).json({ success: false, error: 'Recorded lesson is not published.' });
      }
      if (isLessonExpired(lesson, new Date())) {
        return res.status(410).json({ success: false, error: 'Recorded lesson has expired under the retention policy.' });
      }
      const student = await scopedDb.collection('students').findOne({
        $or: [
          { userId: String(persisted.id || persisted._id) },
          { userId: String(persisted._id || '') },
          { id: String(persisted.studentId || '') },
        ],
      });
      if (
        !student ||
        String(student.branchId) !== String(lesson.branchId) ||
        String(student.classId) !== String(lesson.classId) ||
        (student.section && String(student.section) !== String(lesson.section))
      ) {
        return res.status(403).json({
          success: false,
          error: 'Student is not enrolled in the class/section for this recorded lesson.',
        });
      }

      const percent = Number(req.body?.percent);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        return res.status(400).json({ success: false, error: 'percent must be between 0 and 100.' });
      }
      const watchedSeconds = Math.max(0, Math.min(Number(lesson.durationSeconds || 14400), Number(req.body?.watchedSeconds) || Math.round(((lesson.durationSeconds || 0) * percent) / 100)));
      const resourceId = `resource-lesson-${lesson.id}`;
      const now = new Date();
      const progressDoc = {
        id: `prog-${lesson.id}-${student.id}`,
        lessonId: lesson.id,
        resourceId,
        studentId: String(student.id),
        studentName: student.fullName || student.name || 'Student',
        branchId: String(lesson.branchId),
        classId: String(lesson.classId),
        section: String(lesson.section),
        percent,
        watchedSeconds,
        completedAt: percent === 100 ? now : null,
        updatedAt: now,
      };
      const existingProgress = await scopedDb.collection('learningProgress').findOne({
        studentId: String(student.id),
        resourceId,
      });
      if (existingProgress) {
        await scopedDb.collection('learningProgress').updateOne(
          { studentId: String(student.id), resourceId },
          { $set: progressDoc },
        );
      } else {
        await scopedDb.collection('learningProgress').insertOne({
          ...progressDoc,
          createdAt: now,
        });
      }
      return res.status(200).json({ success: true, data: progressDoc });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Unable to save recorded lesson progress.',
      });
    }
  });

  // Step 6: Student quiz attempt on a published recorded lesson (Server-side scoring, progress sync)
  router.post('/:lessonId/quiz-attempts', async (req, res) => {
    try {
      if (!req.user?.id || req.user?.role !== 'student') {
        return res.status(403).json({ success: false, error: 'Only an enrolled Student can submit a lesson quiz attempt.' });
      }
      const db = database();
      const persisted = await resolvePersistedUser(db, req.user, req.authenticatedUserRecord);
      if (!persisted.schoolId) {
        return res.status(503).json({ success: false, error: 'Verified school mapping is required.' });
      }
      const scopedDb = await verifiedSchoolDatabase(db, persisted);
      const lesson = await scopedDb.collection('recordedLessons').findOne({ id: String(req.params.lessonId) });
      if (!lesson || lesson.deletedAt) {
        return res.status(404).json({ success: false, error: 'Recorded lesson was not found.' });
      }
      if (lesson.published !== true || lesson.status !== 'published') {
        return res.status(403).json({ success: false, error: 'Recorded lesson is not published.' });
      }
      if (isLessonExpired(lesson, new Date())) {
        return res.status(410).json({ success: false, error: 'Recorded lesson has expired under the retention policy.' });
      }

      const student = await scopedDb.collection('students').findOne({
        $or: [
          { userId: String(persisted.id || persisted._id) },
          { userId: String(persisted._id || '') },
          { id: String(persisted.studentId || '') },
        ],
      });
      if (
        !student ||
        String(student.branchId) !== String(lesson.branchId) ||
        String(student.classId) !== String(lesson.classId) ||
        (student.section && String(student.section) !== String(lesson.section))
      ) {
        return res.status(403).json({
          success: false,
          error: 'Student is not enrolled in the class/section for this recorded lesson.',
        });
      }

      const questions = lesson.reviewedMaterial?.quizQuestions || [];
      if (!Array.isArray(questions) || questions.length === 0) {
        return res.status(404).json({ success: false, error: 'No approved quiz is attached to this recorded lesson.' });
      }

      const answers = req.body?.answers;
      if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
        return res.status(400).json({ success: false, error: 'Submitted answers object is required.' });
      }

      let score = 0;
      let earnedPoints = 0;
      let totalPoints = 0;
      questions.forEach((q, idx) => {
        const pts = Math.max(1, Number(q.points) || 1);
        totalPoints += pts;
        const key = String(q.id || `q-${idx + 1}`);
        const raw = answers[key] !== undefined ? answers[key] : answers[String(idx)];
        if (raw === undefined || raw === null) return;
        const expectedIdx = Number(q.correctOption);
        const expectedText = Array.isArray(q.options) ? q.options[expectedIdx] : undefined;
        if (Number(raw) === expectedIdx || (expectedText !== undefined && String(raw) === String(expectedText))) {
          score += 1;
          earnedPoints += pts;
        }
      });

      const total = questions.length;
      const percentage = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;
      const quizId = `quiz-lesson-${lesson.id}-v${lesson.publishedVersion || lesson.sourceVersion}`;
      const now = new Date();
      const attempt = {
        id: crypto.randomUUID(),
        quizId,
        lessonId: lesson.id,
        sourceVersion: lesson.publishedVersion || lesson.sourceVersion,
        studentId: String(student.id),
        studentName: student.fullName || student.name || 'Student',
        branchId: String(lesson.branchId),
        classId: String(lesson.classId),
        section: String(lesson.section),
        answers,
        score,
        total,
        earnedPoints,
        totalPoints,
        percentage,
        status: 'scored',
        submittedAt: now,
      };
      await scopedDb.collection('quizAttempts').insertOne(attempt);
      return res.status(201).json({
        success: true,
        data: {
          id: attempt.id,
          quizId: attempt.quizId,
          lessonId: attempt.lessonId,
          studentId: attempt.studentId,
          score,
          total,
          earnedPoints,
          totalPoints,
          percentage,
          status: attempt.status,
          submittedAt: attempt.submittedAt,
        },
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Unable to submit recorded lesson quiz attempt.',
      });
    }
  });

  // Step 7: Teacher, Principal, Super Admin, and Verified Parent visibility into lesson progress & quiz scores
  router.get('/:lessonId/results', async (req, res) => {
    try {
      if (!req.user?.id || !req.user?.role || !ALL_LEARNER_AND_STAFF_ROLES.has(req.user.role)) {
        return res.status(401).json({ success: false, error: 'Authentication is required.' });
      }
      const db = database();
      const persisted = await resolvePersistedUser(db, req.user, req.authenticatedUserRecord);
      if (!persisted.schoolId) {
        return res.status(503).json({ success: false, error: 'Verified school mapping is required.' });
      }
      const scopedDb = await verifiedSchoolDatabase(db, persisted);
      const lesson = await scopedDb.collection('recordedLessons').findOne({ id: String(req.params.lessonId) });
      if (!lesson || lesson.deletedAt) {
        return res.status(404).json({ success: false, error: 'Recorded lesson was not found.' });
      }

      const resourceId = `resource-lesson-${lesson.id}`;
      let allowedStudentIds = null;

      if (STAFF_ROLES.has(persisted.role)) {
        const scope = await resolveStaffScope(req, database);
        if (scope.branchId && String(lesson.branchId) !== String(scope.branchId)) {
          return res.status(403).json({ success: false, error: 'Cross-branch access is denied.' });
        }
        if (scope.role === 'teacher') {
          await assertTeacherClassAccess(scopedDb, scope, lesson.classId, lesson.section);
        }
      } else if (persisted.role === 'parent') {
        if (lesson.published !== true || lesson.status !== 'published') {
          return res.status(403).json({ success: false, error: 'Recorded lesson is not published.' });
        }
        const links = await scopedDb
          .collection('parentChildLinks')
          .find({
            parentUserId: { $in: [String(persisted.id || ''), String(persisted._id || '')].filter(Boolean) },
            status: 'verified',
            revokedAt: null,
          })
          .limit(50)
          .toArray();
        const linkedIds = links.map(l => String(l.studentId)).filter(Boolean);
        const children = linkedIds.length
          ? await scopedDb
              .collection('students')
              .find({
                id: { $in: linkedIds },
                branchId: lesson.branchId,
                classId: lesson.classId,
                ...(lesson.section ? { section: lesson.section } : {}),
              })
              .limit(50)
              .toArray()
          : [];
        if (!children.length) {
          return res.status(403).json({
            success: false,
            error: 'No verified linked child belongs to the class/section for this recorded lesson.',
          });
        }
        allowedStudentIds = new Set(children.map(c => String(c.id)));
      } else if (persisted.role === 'student') {
        if (lesson.published !== true || lesson.status !== 'published') {
          return res.status(403).json({ success: false, error: 'Recorded lesson is not published.' });
        }
        const student = await scopedDb.collection('students').findOne({
          $or: [
            { userId: String(persisted.id || persisted._id) },
            { userId: String(persisted._id || '') },
            { id: String(persisted.studentId || '') },
          ],
        });
        if (
          !student ||
          String(student.branchId) !== String(lesson.branchId) ||
          String(student.classId) !== String(lesson.classId) ||
          (student.section && String(student.section) !== String(lesson.section))
        ) {
          return res.status(403).json({
            success: false,
            error: 'Student is not enrolled in the class/section for this recorded lesson.',
          });
        }
        allowedStudentIds = new Set([String(student.id)]);
      }

      const [allProgress, allAttempts] = await Promise.all([
        scopedDb.collection('learningProgress').find({ resourceId }).limit(500).toArray(),
        scopedDb.collection('quizAttempts').find({ lessonId: lesson.id }).sort({ submittedAt: -1 }).limit(500).toArray(),
      ]);

      const progress = allowedStudentIds
        ? allProgress.filter(p => allowedStudentIds.has(String(p.studentId)))
        : allProgress;
      const quizAttempts = allowedStudentIds
        ? allAttempts.filter(a => allowedStudentIds.has(String(a.studentId)))
        : allAttempts;

      return res.json({
        success: true,
        data: {
          lessonId: lesson.id,
          title: lesson.title,
          subject: lesson.subject,
          chapter: lesson.chapter || null,
          topic: lesson.topic || null,
          classId: lesson.classId,
          section: lesson.section,
          progress,
          quizAttempts: quizAttempts.map(({ answers, ...summary }) => summary),
        },
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Unable to load recorded lesson results.',
      });
    }
  });

  // Delete / unpublish recorded lesson and purge stored media binary
  router.delete('/:lessonId', async (req, res) => {
    try {
      const scope = await resolveStaffScope(req, database);
      const lesson = await scope.scopedDb.collection('recordedLessons').findOne({
        id: String(req.params.lessonId),
        ...(scope.branchId ? { branchId: scope.branchId } : {}),
      });
      if (!lesson || lesson.deletedAt) {
        return res.status(404).json({ success: false, error: 'Recorded lesson was not found.' });
      }
      if (scope.role === 'teacher') {
        if (!scope.actorIds.has(String(lesson.teacherUserId))) {
          throw httpError('Teachers may only delete their own recorded lessons.', 403);
        }
        await assertTeacherClassAccess(scope.scopedDb, scope, lesson.classId, lesson.section);
      }

      const now = new Date();
      await scope.scopedDb.collection('recordedLessonMedia').deleteOne({ lessonId: lesson.id });
      await scope.scopedDb.collection('learningResources').deleteOne({ id: `resource-lesson-${lesson.id}` });
      await scope.scopedDb.collection('recordedLessons').updateOne(
        { id: lesson.id },
        {
          $set: {
            published: false,
            status: 'deleted',
            media: null,
            mediaPlaybackPath: null,
            deletedAt: now,
            deletedByUserId: scope.userId,
            updatedAt: now,
          },
        },
      );

      return res.json({
        success: true,
        data: { id: lesson.id, status: 'deleted', deletedAt: now },
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Unable to delete recorded lesson.',
      });
    }
  });

  // Purge expired recorded lessons according to retention policy
  router.post('/purge-expired', async (req, res) => {
    try {
      const scope = await resolveStaffScope(req, database);
      if (!['principal', 'super_admin'].includes(scope.role)) {
        throw httpError('Principal or Super Admin authority is required to purge expired recordings.', 403);
      }
      const now = new Date();
      const filter = scope.branchId ? { branchId: scope.branchId } : {};
      const allLessons = await scope.scopedDb.collection('recordedLessons').find(filter).limit(500).toArray();
      const expired = allLessons.filter(l => !l.deletedAt && isLessonExpired(l, now));

      let purgedCount = 0;
      for (const item of expired) {
        await scope.scopedDb.collection('recordedLessonMedia').deleteOne({ lessonId: item.id });
        await scope.scopedDb.collection('learningResources').deleteOne({ id: `resource-lesson-${item.id}` });
        await scope.scopedDb.collection('recordedLessons').updateOne(
          { id: item.id },
          {
            $set: {
              published: false,
              status: 'expired_purged',
              media: null,
              mediaPlaybackPath: null,
              deletedAt: now,
              updatedAt: now,
            },
          },
        );
        purgedCount += 1;
      }

      return res.json({ success: true, data: { purgedCount } });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : 'Unable to purge expired recorded lessons.',
      });
    }
  });

  router.use((error, _req, res, next) => {
    if (error instanceof multer.MulterError) {
      const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({
        success: false,
        error: status === 413 ? 'Media upload exceeds the 25 MB limit.' : 'Invalid multipart media upload.',
      });
    }
    return next(error);
  });

  return router;
}

module.exports = {
  createRecordedLessonRouter,
  defaultGeminiAiAdapter,
  validateMediaBuffer,
};
