const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { getDatabase: defaultGetDatabase } = require('./database');
const { apiId, referenceValues } = require('./identityReferenceAdapter');
const {
  HISTORY_PAGE_SIZE,
  MAX_MESSAGE_LENGTH,
  MAX_CHAT_ATTACHMENT_BYTES,
  authorizedPairs,
  canAccessConversation,
  decodeCursor,
  encodeCursor,
  getStudentForParticipant,
  hashToken,
  listAssignedTeachers,
  serializeMessage,
  validateChatAttachment,
} = require('./chatService');

const SOCKET_TICKET_TTL_MS = 30_000;
let realtimePublisher = () => {};
const chatUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CHAT_ATTACHMENT_BYTES, files: 1, fields: 2 },
});

function parseChatAttachment(req, res, next) {
  chatUpload.single('file')(req, res, error => {
    if (error instanceof multer.MulterError) {
      return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
        success: false,
        error: error.code === 'LIMIT_FILE_SIZE'
          ? 'Chat images must be 10 MB or smaller.'
          : 'Only one image attachment is allowed.',
      });
    }
    if (error) return res.status(400).json({ success: false, error: 'The image could not be read.' });
    return next();
  });
}

function setChatRealtimePublisher(publish) {
  realtimePublisher = typeof publish === 'function' ? publish : () => {};
}

function publishRealtime(publish, event, conversation) {
  try {
    Promise.resolve(publish(event, conversation)).catch(error => {
      console.error(`Chat event delivery failed (${error.name}).`);
    });
  } catch (error) {
    console.error(`Chat event delivery failed (${error.name}).`);
  }
}

async function initializeChatIndexes(getDatabase = defaultGetDatabase) {
  const db = getDatabase();
  await Promise.all([
    db.collection('chatConversations').createIndex(
      { studentId: 1, teacherUserId: 1 },
      { unique: true, name: 'unique_student_teacher_chat' },
    ),
    db.collection('chatMessages').createIndex(
      { conversationId: 1, createdAt: -1, _id: -1 },
      { name: 'chat_messages_by_conversation' },
    ),
    db.collection('chatAttachments').createIndex(
      { id: 1 },
      { unique: true, name: 'unique_chat_attachment_id' },
    ),
    db.collection('chatAttachments').createIndex(
      { conversationId: 1, createdAt: -1 },
      { name: 'chat_attachments_by_conversation' },
    ),
    db.collection('chatMessages').createIndex(
      { senderUserId: 1, clientMessageId: 1 },
      { unique: true, name: 'unique_chat_sender_client_message' },
    ),
    db.collection('chatSocketTickets').createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'chat_socket_ticket_ttl' },
    ),
  ]);
}

async function consumeChatSocketTicket(db, ticket) {
  if (typeof ticket !== 'string' || ticket.length < 32 || ticket.length > 200)
    return null;
  const now = new Date();
  const result = await db.collection('chatSocketTickets').findOneAndDelete({
    tokenHash: hashToken(ticket),
    expiresAt: { $gt: now },
  });
  const record = result?.value || result;
  if (!record?.userId || !record?.accessTokenHash) return null;
  if (!['student', 'parent', 'teacher'].includes(record.role)) return null;
  const identity = await require('./auth').getSessionIdentity(db, record.accessTokenHash, {userId: record.userId, role: record.role});
  if (!identity) return null;
  return {
    ...identity.user,
    schoolId: identity.record.schoolId ? String(identity.record.schoolId) : undefined,
    sessionUserId: String(identity.session.userId),
    accessTokenHash: record.accessTokenHash,
  };
}

function isDuplicateKey(error) {
  return error?.code === 11000;
}

function serializeConversation(conversation, student, teacher, unreadCount) {
  const lastMessage = conversation.lastMessage
    ? {
        body: conversation.lastMessage.body,
        senderRole: conversation.lastMessage.senderRole,
        createdAt: conversation.lastMessage.createdAt,
      }
    : null;
  return {
    id: conversation.id,
    studentId: String(apiId(student)),
    studentName: student.fullName || student.name || 'Student',
    teacherId: String(teacher.id),
    teacherName: teacher.fullName || teacher.name || 'Class teacher',
    lastMessage,
    updatedAt: conversation.updatedAt,
    unreadCount,
  };
}

function createChatRouter({
  getDatabase = defaultGetDatabase,
  publish = (event, conversation) => realtimePublisher(event, conversation),
} = {}) {
  const router = express.Router();

  router.post('/session', async (req, res, next) => {
    try {
      if (!['student', 'parent', 'teacher'].includes(req.user?.role)) {
        return res.status(403).json({
          success: false,
          error: 'Chat access is available only to students, parents and teachers.',
        });
      }
      const match = /^Bearer\s+([A-Za-z0-9_-]{32,})$/.exec(
        req.get('Authorization') || '',
      );
      if (!match) return res.status(401).json({ success: false, error: 'Authentication is required.' });
      const db = getDatabase();
      const accessTokenHash = hashToken(match[1]);
      const session = await db.collection('refreshTokens').findOne({
        tokenHash: accessTokenHash,
        type: 'access',
        userId: {$in: req.authenticatedUserRecord ? referenceValues(req.authenticatedUserRecord) : [req.user.id]},
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      });
      if (!session) return res.status(401).json({ success: false, error: 'Session is invalid or expired.' });

      const ticket = crypto.randomBytes(32).toString('base64url');
      await db.collection('chatSocketTickets').insertOne({
        tokenHash: hashToken(ticket),
        userId: String(session.userId),
        role: req.user.role,
        accessTokenHash,
        expiresAt: new Date(Date.now() + SOCKET_TICKET_TTL_MS),
        createdAt: new Date(),
      });
      return res.status(201).json({
        success: true,
        data: { ticket, expiresInMs: SOCKET_TICKET_TTL_MS },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/teachers', async (req, res, next) => {
    try {
      const studentId = String(req.query.studentId || '').trim();
      const student = await getStudentForParticipant(getDatabase(), req.user, studentId);
      if (!student) return res.status(404).json({ success: false, error: 'Student was not found.' });
      const teachers = await listAssignedTeachers(getDatabase(), student);
      return res.json({ success: true, data: { student: { id: String(apiId(student)), fullName: student.fullName || student.name || '' }, teachers } });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/conversations', async (req, res, next) => {
    try {
      const requestedStudentId = String(req.query.studentId || '').trim();
      if (requestedStudentId.length > 120) return res.status(400).json({ success: false, error: 'studentId is too long.' });
      const db = getDatabase();
      const pairs = await authorizedPairs(db, req.user, requestedStudentId);
      if (requestedStudentId && req.user.role !== 'teacher' && !pairs.length) {
        return res.status(404).json({ success: false, error: 'Student was not found.' });
      }
      const pairMap = new Map(pairs.map(pair => [`${apiId(pair.student)}\u0000${pair.teacher.id}`, pair]));
      if (!pairMap.size) return res.json({ success: true, data: { conversations: [], unreadCount: 0 } });
      const documents = await db.collection('chatConversations')
        .find({ studentId: { $in: [...new Set(pairs.map(pair => String(apiId(pair.student))))] }, teacherUserId: { $in: [...new Set(pairs.map(pair => pair.teacher.id))] } })
        .sort({ updatedAt: -1 })
        .limit(100)
        .toArray();
      const conversations = [];
      for (const conversation of documents) {
        const pair = pairMap.get(`${conversation.studentId}\u0000${conversation.teacherUserId}`);
        if (!pair) continue;
        const unreadCount = await db.collection('chatMessages').countDocuments({
          conversationId: conversation.id,
          senderUserId: { $ne: String(req.user.id) },
          readByUserIds: { $ne: String(req.user.id) },
        });
        conversations.push(serializeConversation(conversation, pair.student, pair.teacher, unreadCount));
      }
      return res.json({
        success: true,
        data: {
          conversations,
          unreadCount: conversations.reduce((total, item) => total + item.unreadCount, 0),
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/conversations', async (req, res, next) => {
    try {
      const db = getDatabase();
      const studentId = String(req.body?.studentId || '').trim();
      const teacherId = String(req.body?.teacherId || '').trim();
      const student = await getStudentForParticipant(db, req.user, studentId);
      if (!student) return res.status(404).json({ success: false, error: 'Student was not found.' });
      const teachers = await listAssignedTeachers(db, student);
      const teacher = teachers.find(item => item.id === teacherId);
      if (!teacher) return res.status(403).json({ success: false, error: 'That teacher is not currently assigned to this student.' });

      const studentApiId = String(apiId(student));
      const schoolScopeId = student.tenantScope?.schoolIdHex || (student.schoolId ? String(student.schoolId) : null);
      const conversationLookup = {
        ...(student.tenantScope?.schoolFilter || (schoolScopeId ? { schoolId: schoolScopeId } : {})),
        studentId: studentApiId,
        teacherUserId: teacher.id,
      };
      let conversation = await db.collection('chatConversations').findOne(conversationLookup);
      if (!conversation) {
        const now = new Date();
        const candidate = {
          id: crypto.randomUUID(),
          ...(schoolScopeId ? { schoolId: schoolScopeId } : {}),
          studentId: studentApiId,
          teacherUserId: teacher.id,
          classId: String(student.classId),
          ...(student.branchId ? { branchId: String(student.branchId) } : {}),
          createdAt: now,
          updatedAt: now,
          lastMessage: null,
        };
        try {
          await db.collection('chatConversations').insertOne(candidate);
          conversation = candidate;
        } catch (error) {
          if (!isDuplicateKey(error)) throw error;
          conversation = await db.collection('chatConversations').findOne(conversationLookup);
        }
      }
      return res.status(201).json({ success: true, data: serializeConversation(conversation, student, teacher, 0) });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/conversations/:conversationId/messages', async (req, res, next) => {
    try {
      const db = getDatabase();
      const conversation = await db.collection('chatConversations').findOne({ id: req.params.conversationId });
      const access = await canAccessConversation(db, req.user, conversation);
      if (!access) return res.status(404).json({ success: false, error: 'Conversation was not found.' });

      const query = { conversationId: conversation.id };
      if (req.query.cursor) {
        const cursor = decodeCursor(String(req.query.cursor));
        if (!cursor) return res.status(400).json({ success: false, error: 'Message history cursor is invalid.' });
        query.$or = [
          { createdAt: { $lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
        ];
      }
      const results = await db.collection('chatMessages').find(query)
        .sort({ createdAt: -1, _id: -1 })
        .limit(HISTORY_PAGE_SIZE + 1)
        .toArray();
      const hasMore = results.length > HISTORY_PAGE_SIZE;
      const page = results.slice(0, HISTORY_PAGE_SIZE);
      const messages = page.reverse().map(message => serializeMessage(message, req.user.id));
        const nextCursor = hasMore && page.length ? encodeCursor(page[0]) : null;
      return res.json({ success: true, data: { messages, hasMore, nextCursor } });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/conversations/:conversationId/attachments', parseChatAttachment, async (req, res, next) => {
    let attachmentId;
    try {
      const db = getDatabase();
      const conversation = await db.collection('chatConversations').findOne({ id: req.params.conversationId });
      const access = await canAccessConversation(db, req.user, conversation);
      if (!access) return res.status(404).json({ success: false, error: 'Conversation was not found.' });

      const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
      const clientMessageId = String(req.body?.clientMessageId || '');
      if (body.length > MAX_MESSAGE_LENGTH || (!body && !req.file)) {
        return res.status(400).json({ success: false, error: `A message or image is required; message text may be up to ${MAX_MESSAGE_LENGTH} characters.` });
      }
      if (!/^[A-Za-z0-9_-]{16,100}$/.test(clientMessageId)) {
        return res.status(400).json({ success: false, error: 'A valid clientMessageId is required.' });
      }
      if (!req.file) return res.status(400).json({ success: false, error: 'Choose an image to attach.' });

      const messages = db.collection('chatMessages');
      const previous = await messages.findOne({ senderUserId: String(req.user.id), clientMessageId });
      if (previous) {
        if (previous.conversationId !== conversation.id) return res.status(409).json({ success: false, error: 'That message identifier has already been used.' });
        return res.json({ success: true, data: { message: serializeMessage(previous, req.user.id), duplicate: true } });
      }

      const validation = validateChatAttachment(req.file);
      if (validation.error) return res.status(400).json({ success: false, error: validation.error });
      const now = new Date();
      attachmentId = crypto.randomUUID();
      const schoolScopeId = conversation.schoolId
        ? String(conversation.schoolId)
        : access.student?.tenantScope?.schoolIdHex || (access.student?.schoolId ? String(access.student.schoolId) : null);
      const attachment = {
        id: attachmentId,
        ...(schoolScopeId ? { schoolId: schoolScopeId } : {}),
        conversationId: conversation.id,
        studentId: conversation.studentId,
        teacherUserId: conversation.teacherUserId,
        uploadedByUserId: String(req.user.id),
        branchId: String(conversation.branchId),
        fileName: validation.fileName,
        contentType: validation.contentType,
        fileSize: req.file.size,
        data: req.file.buffer,
        createdAt: now,
      };
      await db.collection('chatAttachments').insertOne(attachment);

      const message = {
        id: crypto.randomUUID(),
        ...(schoolScopeId ? { schoolId: schoolScopeId } : {}),
        conversationId: conversation.id,
        studentId: conversation.studentId,
        teacherUserId: conversation.teacherUserId,
        senderUserId: String(req.user.id),
        senderRole: req.user.role,
        clientMessageId,
        body,
        attachments: [{
          id: attachmentId,
          fileName: validation.fileName,
          contentType: validation.contentType,
          fileSize: req.file.size,
        }],
        createdAt: now,
        readByUserIds: [],
        readReceipts: [],
      };
      try {
        const inserted = await messages.insertOne(message);
        message._id = inserted.insertedId;
      } catch (error) {
        await db.collection('chatAttachments').deleteOne({ id: attachmentId });
        attachmentId = null;
        if (!isDuplicateKey(error)) throw error;
        const duplicate = await messages.findOne({ senderUserId: String(req.user.id), clientMessageId });
        if (!duplicate || duplicate.conversationId !== conversation.id) return res.status(409).json({ success: false, error: 'That message identifier has already been used.' });
        return res.json({ success: true, data: { message: serializeMessage(duplicate, req.user.id), duplicate: true } });
      }
      const lastMessage = { body: body || 'Image attached', senderRole: req.user.role, createdAt: now, hasAttachment: true };
      await db.collection('chatConversations').updateOne(
        { id: conversation.id },
        { $set: { updatedAt: now, lastMessage } },
      );
      const payload = serializeMessage(message, req.user.id);
      publishRealtime(publish, { type: 'message.created', conversationId: conversation.id, message: payload }, conversation);
      return res.status(201).json({ success: true, data: { message: payload, duplicate: false } });
    } catch (error) {
      if (attachmentId) {
        try { await getDatabase().collection('chatAttachments').deleteOne({ id: attachmentId }); } catch { /* preserve the original failure */ }
      }
      return next(error);
    }
  });

  router.get('/attachments/:attachmentId', async (req, res, next) => {
    try {
      const db = getDatabase();
      const attachment = await db.collection('chatAttachments').findOne({ id: req.params.attachmentId }, {promoteBuffers: true});
      if (!attachment) return res.status(404).json({ success: false, error: 'Attachment was not found.' });
      const conversation = await db.collection('chatConversations').findOne({ id: attachment.conversationId });
      const access = await canAccessConversation(db, req.user, conversation);
      if (!access) return res.status(404).json({ success: false, error: 'Attachment was not found.' });
      if (!Buffer.isBuffer(attachment.data) || !['image/jpeg', 'image/png', 'image/webp'].includes(attachment.contentType)) {
        return res.status(404).json({ success: false, error: 'Attachment was not found.' });
      }
      res.set({
        'Content-Type': attachment.contentType,
        'Content-Length': String(attachment.fileSize),
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.status(200).send(attachment.data);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/conversations/:conversationId/messages', async (req, res, next) => {
    try {
      const db = getDatabase();
      const conversation = await db.collection('chatConversations').findOne({ id: req.params.conversationId });
      const access = await canAccessConversation(db, req.user, conversation);
      if (!access) return res.status(404).json({ success: false, error: 'Conversation was not found.' });
      const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
      const clientMessageId = String(req.body?.clientMessageId || '');
      if (!body || body.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json({ success: false, error: `Message must contain 1 to ${MAX_MESSAGE_LENGTH} characters.` });
      }
      if (!/^[A-Za-z0-9_-]{16,100}$/.test(clientMessageId)) {
        return res.status(400).json({ success: false, error: 'A valid clientMessageId is required.' });
      }
      const messages = db.collection('chatMessages');
      const previous = await messages.findOne({ senderUserId: String(req.user.id), clientMessageId });
      if (previous) {
        if (previous.conversationId !== conversation.id) return res.status(409).json({ success: false, error: 'That message identifier has already been used.' });
        if (previous.body !== body || previous.attachments?.length) return res.status(409).json({success: false, error: 'That message identifier belongs to a different payload.'});
        return res.json({ success: true, data: { message: serializeMessage(previous, req.user.id), duplicate: true } });
      }
      const schoolScopeId = conversation.schoolId
        ? String(conversation.schoolId)
        : access.student?.tenantScope?.schoolIdHex || (access.student?.schoolId ? String(access.student.schoolId) : null);
      const message = {
        id: crypto.randomUUID(),
        ...(schoolScopeId ? { schoolId: schoolScopeId } : {}),
        conversationId: conversation.id,
        studentId: conversation.studentId,
        teacherUserId: conversation.teacherUserId,
        senderUserId: String(req.user.id),
        senderRole: req.user.role,
        clientMessageId,
        body,
        createdAt: new Date(),
        readByUserIds: [],
        readReceipts: [],
      };
      try {
        const inserted = await messages.insertOne(message);
        message._id = inserted.insertedId;
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        const duplicate = await messages.findOne({ senderUserId: String(req.user.id), clientMessageId });
        if (!duplicate) throw error;
        if (duplicate.conversationId !== conversation.id || duplicate.body !== body || duplicate.attachments?.length) return res.status(409).json({success: false, error: 'That message identifier belongs to a different request.'});
        return res.json({ success: true, data: { message: serializeMessage(duplicate, req.user.id), duplicate: true } });
      }
      const updatedAt = message.createdAt;
      await db.collection('chatConversations').updateOne(
        { id: conversation.id },
        { $set: { updatedAt, lastMessage: { body, senderRole: req.user.role, createdAt: updatedAt } } },
      );
      const payload = serializeMessage(message, req.user.id);
      publishRealtime(publish, { type: 'message.created', conversationId: conversation.id, message: payload }, conversation);
      return res.status(201).json({ success: true, data: { message: payload, duplicate: false } });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/conversations/:conversationId/read', async (req, res, next) => {
    try {
      const db = getDatabase();
      const conversation = await db.collection('chatConversations').findOne({ id: req.params.conversationId });
      const access = await canAccessConversation(db, req.user, conversation);
      if (!access) return res.status(404).json({ success: false, error: 'Conversation was not found.' });
      const messages = db.collection('chatMessages');
      const filter = {
        conversationId: conversation.id,
        senderUserId: { $ne: String(req.user.id) },
        readByUserIds: { $ne: String(req.user.id) },
      };
      const unread = await messages.find(filter, { projection: { id: 1 } }).toArray();
      const readAt = new Date();
      const result = await messages.updateMany(
        filter,
        {
          $addToSet: { readByUserIds: String(req.user.id) },
          $push: { readReceipts: { userId: String(req.user.id), role: req.user.role, readAt } },
        },
      );
      if (result.modifiedCount) {
        publishRealtime(publish, {
          type: 'read.receipt',
          conversationId: conversation.id,
          messageIds: unread.map(message => String(message.id)),
          readerRole: req.user.role,
          readAt,
        }, conversation);
      }
      return res.json({ success: true, data: { markedRead: result.modifiedCount || 0, readAt } });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = {
  createChatRouter,
  initializeChatIndexes,
  consumeChatSocketTicket,
  setChatRealtimePublisher,
  SOCKET_TICKET_TTL_MS,
};
