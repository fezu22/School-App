const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { MAX_CHAT_ATTACHMENT_BYTES } = require('./chatService');
const express = require('express');
const WebSocket = require('ws');
const { ObjectId } = require('mongodb');
const { authorizedPairs, canAccessConversation, getVerifiedChildren, hashToken, validateChatAttachment } = require('./chatService');
const {
  consumeChatSocketTicket,
  createChatRouter,
} = require('./chatRoutes');
const { attachChatRealtime } = require('./chatRealtime');

function equal(left, right) {
  if (left instanceof Date || right instanceof Date)
    return new Date(left).getTime() === new Date(right).getTime();
  return String(left) === String(right);
}

function matchesValue(actual, expected) {
  if (expected === null) return actual == null;
  if (expected && typeof expected === 'object' && !(expected instanceof Date) && !ObjectId.isValid(expected)) {
    return Object.entries(expected).every(([operator, value]) => {
      if (operator === '$ne') return actual == null || !(Array.isArray(actual) ? actual.some(item => matchesValue(item, value)) : matchesValue(actual, value));
      if (operator === '$in') return Array.isArray(actual) ? actual.some(actualItem => value.some(item => matchesValue(actualItem, item))) : value.some(item => matchesValue(actual, item));
      if (operator === '$gt') return actual > value;
      if (operator === '$lt') return actual < value;
      if (operator === '$eq') return matchesValue(actual, value);
      if (operator === '$type') return typeof actual === 'string';
      return false;
    });
  }
  if (Array.isArray(actual)) return actual.some(item => matchesValue(item, expected));
  return equal(actual, expected);
}

function matches(document, query = {}) {
  return Object.entries(query).every(([key, expected]) => {
    if (key === '$or') return expected.some(item => matches(document, item));
    if (key === '$and') return expected.every(item => matches(document, item));
    return matchesValue(document[key], expected);
  });
}

class MemoryCollection {
  constructor(rows = []) {
    this.rows = rows;
  }
  find(query = {}) {
    let rows = this.rows.filter(row => matches(row, query));
    let max = Infinity;
    const cursor = {
      sort: order => {
        const fields = Object.entries(order);
        rows = [...rows].sort((left, right) => {
          for (const [field, direction] of fields) {
            const a = left[field] instanceof Date ? left[field].getTime() : left[field];
            const b = right[field] instanceof Date ? right[field].getTime() : right[field];
            if (a === b) continue;
            return (a > b ? 1 : -1) * direction;
          }
          return 0;
        });
        return cursor;
      },
      limit: count => {
        max = count;
        return cursor;
      },
      toArray: async () => rows.slice(0, max),
    };
    return cursor;
  }
  async findOne(query = {}) {
    return this.rows.find(row => matches(row, query)) || null;
  }
  async insertOne(document) {
    if (this.rows.some(row =>
      document.senderUserId
        ? row.senderUserId === document.senderUserId && row.clientMessageId === document.clientMessageId
        : document.studentId && row.studentId === document.studentId && row.teacherUserId === document.teacherUserId,
    )) {
      const error = new Error('duplicate');
      error.code = 11000;
      throw error;
    }
    const record = { ...document, _id: new ObjectId() };
    this.rows.push(record);
    return { insertedId: record._id };
  }
  async updateOne(query, update) {
    const row = this.rows.find(item => matches(item, query));
    if (!row) return { modifiedCount: 0 };
    Object.assign(row, update.$set || {});
    return { modifiedCount: 1 };
  }
  async updateMany(query, update) {
    const rows = this.rows.filter(item => matches(item, query));
    rows.forEach(row => {
      for (const [key, value] of Object.entries(update.$addToSet || {})) {
        row[key] ||= [];
        if (!row[key].some(item => equal(item, value))) row[key].push(value);
      }
      for (const [key, value] of Object.entries(update.$push || {})) {
        row[key] ||= [];
        row[key].push(value);
      }
    });
    return { modifiedCount: rows.length };
  }
  async countDocuments(query = {}) {
    return this.rows.filter(row => matches(row, query)).length;
  }
  async findOneAndDelete(query = {}) {
    const index = this.rows.findIndex(row => matches(row, query));
    return index < 0 ? null : this.rows.splice(index, 1)[0];
  }
  async deleteOne(query = {}) {
    const index = this.rows.findIndex(row => matches(row, query));
    if (index < 0) return { deletedCount: 0 };
    this.rows.splice(index, 1);
    return { deletedCount: 1 };
  }
  async createIndex() {
    return 'ok';
  }
}

const accessTokens = {
  student: 'student-access-token-00000000000000000000000000000001',
  studentNoBranch: 'student-no-branch-token-0000000000000000000000000001',
  studentOtherBranch: 'student-other-branch-token-00000000000000000000000001',
  parent: 'parent-access-token-00000000000000000000000000000002',
  parentNoBranch: 'parent-no-branch-token-00000000000000000000000000002',
  parentOtherBranch: 'parent-other-branch-token-00000000000000000000000002',
  otherParent: 'other-parent-access-token-000000000000000000000000000003',
  teacher: 'teacher-access-token-00000000000000000000000000000004',
  teacherNoBranch: 'teacher-no-branch-token-00000000000000000000000000004',
  teacherOtherBranch: 'teacher-other-branch-token-00000000000000000000000004',
  otherTeacher: 'other-teacher-access-token-00000000000000000000000000005',
  finance: 'finance-access-token-00000000000000000000000000000006',
};
const actors = {
  [accessTokens.student]: { id: 'student-user', role: 'student', branchId: 'north' },
  [accessTokens.studentNoBranch]: { id: 'student-user', role: 'student' },
  [accessTokens.studentOtherBranch]: { id: 'student-user', role: 'student', branchId: 'south' },
  [accessTokens.parent]: { id: 'parent-user', role: 'parent', branchId: 'north' },
  [accessTokens.parentNoBranch]: { id: 'parent-user', role: 'parent' },
  [accessTokens.parentOtherBranch]: { id: 'parent-user', role: 'parent', branchId: 'south' },
  [accessTokens.otherParent]: { id: 'unlinked-parent', role: 'parent', branchId: 'north' },
  [accessTokens.teacher]: { id: 'teacher-a', role: 'teacher' },
  [accessTokens.teacherNoBranch]: { id: 'teacher-a', role: 'teacher' },
  [accessTokens.teacherOtherBranch]: { id: 'teacher-a', role: 'teacher', branchId: 'south' },
  [accessTokens.otherTeacher]: { id: 'teacher-b', role: 'teacher', branchId: 'south' },
  [accessTokens.finance]: { id: 'finance-user', role: 'finance' },
};
actors[accessTokens.teacher].branchId = 'north';
const northBranch = new ObjectId();
const southBranch = new ObjectId();
const north = northBranch.toHexString();
const south = southBranch.toHexString();
for (const actor of Object.values(actors)) {
  if (actor.branchId === 'north') actor.branchId = north;
  if (actor.branchId === 'south') actor.branchId = south;
}

function makeDatabase() {
  const tokenSessions = Object.entries(actors).map(([token, actor]) => ({
    tokenHash: hashToken(token),
    type: 'access',
    userId: actor.id,
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
  }));
  const collections = {
    users: new MemoryCollection([
      { id: 'student-user', role: 'student', active: true, branchId: north },
      { id: 'parent-user', role: 'parent', active: true, branchId: north },
      { id: 'unlinked-parent', role: 'parent', active: true, branchId: north },
      { id: 'teacher-a', role: 'teacher', fullName: 'Teacher A', active: true, branchId: north },
      { id: 'teacher-b', role: 'teacher', fullName: 'Teacher B', active: true, branchId: south },
      { id: 'finance-user', role: 'finance', active: true },
    ]),
    students: new MemoryCollection([
      { id: '002', userId: 'student-user', fullName: 'Student Two', classId: 'class-a', branchId: north },
      { id: '003', userId: 'other-student', fullName: 'Student Three', classId: 'class-b', branchId: south },
    ]),
    parentChildLinks: new MemoryCollection([
      { parentUserId: 'parent-user', studentId: '002', status: 'verified', revokedAt: null },
      { parentUserId: 'unlinked-parent', studentId: '002', status: 'requested', verified: false, revokedAt: null },
      { parentUserId: 'unlinked-parent', studentId: '003', status: 'verified', revokedAt: new Date() },
    ]),
    classTeacherAssignments: new MemoryCollection([
      { classId: 'class-a', branchId: north, teacherUserId: 'teacher-a', active: true, status: 'assigned' },
      { classId: 'class-b', branchId: south, teacherUserId: 'teacher-b', active: true, status: 'assigned' },
    ]),
    branches: new MemoryCollection([{ _id: northBranch }, { _id: southBranch }]),
    chatConversations: new MemoryCollection(),
    chatMessages: new MemoryCollection(),
    chatAttachments: new MemoryCollection(),
    chatSocketTickets: new MemoryCollection(),
    refreshTokens: new MemoryCollection(tokenSessions),
  };
  return {
    collections,
    collection(name) {
      if (!collections[name]) throw new Error(`Unexpected collection ${name}`);
      return collections[name];
    },
  };
}

function createTestServer(db) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const token = /^Bearer\s+(.+)$/.exec(req.get('Authorization') || '')?.[1];
    req.user = actors[token] || null;
    next();
  });
  const server = http.createServer(app);
  const realtime = attachChatRealtime(server, { getDb: () => db });
  app.use('/api/chat', createChatRouter({ getDatabase: () => db, publish: realtime.publish }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message, code: error.code }));
  return server;
}

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

async function jsonRequest(base, token, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  return { status: response.status, body: await response.json() };
}

async function imageRequest(base, token, path, { name = 'family.png', type = 'image/png', bytes, body = '', clientMessageId }) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), name);
  form.append('body', body);
  form.append('clientMessageId', clientMessageId);
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return { status: response.status, body: await response.json() };
}

test('chat scopes authorized teacher selection to owned or verified children', async t => {
  const db = makeDatabase();
  const server = createTestServer(db);
  const port = await listen(server);
  t.after(() => close(server));
  const base = `http://127.0.0.1:${port}/api/chat`;

  const parent = await jsonRequest(base, accessTokens.parent, '/teachers?studentId=002');
  assert.equal(parent.status, 200);
  assert.deepEqual(parent.body.data.teachers.map(item => item.id), ['teacher-a']);
  const student = await jsonRequest(base, accessTokens.student, '/teachers?studentId=002');
  assert.equal(student.status, 200);
  const enumerated = await jsonRequest(base, accessTokens.student, '/teachers?studentId=003');
  assert.equal(enumerated.status, 404);
  const unverified = await jsonRequest(base, accessTokens.otherParent, '/teachers?studentId=002');
  assert.equal(unverified.status, 404);
  const revoked = await jsonRequest(base, accessTokens.otherParent, '/teachers?studentId=003');
  assert.equal(revoked.status, 404);
  const finance = await jsonRequest(base, accessTokens.finance, '/teachers?studentId=002');
  assert.equal(finance.status, 404);
});

test('chat fails closed when trusted user branch is missing or differs from the student', async t => {
  const db = makeDatabase();
  const server = createTestServer(db);
  const port = await listen(server);
  t.after(() => close(server));
  const base = `http://127.0.0.1:${port}/api/chat`;

  for (const token of [
    accessTokens.studentNoBranch,
    accessTokens.studentOtherBranch,
    accessTokens.parentNoBranch,
    accessTokens.parentOtherBranch,
  ]) {
    const response = await jsonRequest(base, token, '/teachers?studentId=002');
    assert.equal(response.status, 404, `branchless/mismatched actor denied: ${token}`);
  }

  const started = await jsonRequest(base, accessTokens.parent, '/conversations', {
    method: 'POST',
    body: JSON.stringify({ studentId: '002', teacherId: 'teacher-a' }),
  });
  assert.equal(started.status, 201);
  const conversationPath = `/conversations/${started.body.data.id}/messages`;
  for (const token of [accessTokens.teacherNoBranch, accessTokens.teacherOtherBranch]) {
    const response = await jsonRequest(base, token, conversationPath);
    assert.equal(response.status, 404, `branchless/mismatched teacher denied: ${token}`);
  }
});

test('chat requires matching student, assignment and teacher branch IDs', async t => {
  for (const [mutation, expectedListStatus, expectedStartStatus] of [
    [assignment => { delete assignment.branchId; }, 503, 503],
    [assignment => { assignment.branchId = south; }, 200, 403],
  ]) {
    const db = makeDatabase();
    mutation(db.collections.classTeacherAssignments.rows[0]);
    const server = createTestServer(db);
    const port = await listen(server);
    const base = `http://127.0.0.1:${port}/api/chat`;
    try {
      const teachers = await jsonRequest(base, accessTokens.parent, '/teachers?studentId=002');
      assert.equal(teachers.status, expectedListStatus);
      if (teachers.status === 200) assert.deepEqual(teachers.body.data.teachers, []);
      const conversation = await jsonRequest(base, accessTokens.parent, '/conversations', {
        method: 'POST',
        body: JSON.stringify({ studentId: '002', teacherId: 'teacher-a' }),
      });
      assert.equal(conversation.status, expectedStartStatus);
    } finally {
      await close(server);
    }
  }

  const missingTeacherBranch = makeDatabase();
  delete missingTeacherBranch.collections.users.rows.find(row => row.id === 'teacher-a').branchId;
  const server = createTestServer(missingTeacherBranch);
  const port = await listen(server);
  t.after(() => close(server));
  const teachers = await jsonRequest(`http://127.0.0.1:${port}/api/chat`, accessTokens.parent, '/teachers?studentId=002');
  assert.equal(teachers.status, 503);

  const missingStudentBranch = makeDatabase();
  delete missingStudentBranch.collections.students.rows.find(row => row.id === '002').branchId;
  const missingStudentServer = createTestServer(missingStudentBranch);
  const missingStudentPort = await listen(missingStudentServer);
  t.after(() => close(missingStudentServer));
  const missingStudent = await jsonRequest(`http://127.0.0.1:${missingStudentPort}/api/chat`, accessTokens.parent, '/teachers?studentId=002');
  assert.equal(missingStudent.status, 503);
});

test('chat persists messages, returns history, deduplicates retries and records read receipts', async t => {
  const db = makeDatabase();
  const server = createTestServer(db);
  const port = await listen(server);
  t.after(() => close(server));
  const base = `http://127.0.0.1:${port}/api/chat`;

  const started = await jsonRequest(base, accessTokens.parent, '/conversations', {
    method: 'POST',
    body: JSON.stringify({ studentId: '002', teacherId: 'teacher-a' }),
  });
  assert.equal(started.status, 201);
  const conversationId = started.body.data.id;
  const forbidden = await jsonRequest(base, accessTokens.otherParent, '/conversations', {
    method: 'POST',
    body: JSON.stringify({ studentId: '002', teacherId: 'teacher-a' }),
  });
  assert.equal(forbidden.status, 404);
  const wrongTeacher = await jsonRequest(base, accessTokens.parent, '/conversations', {
    method: 'POST',
    body: JSON.stringify({ studentId: '002', teacherId: 'teacher-b' }),
  });
  assert.equal(wrongTeacher.status, 403);

  const clientMessageId = 'message-client-identifier-00001';
  const sent = await jsonRequest(base, accessTokens.parent, `/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body: 'Please share the homework notes.', clientMessageId }),
  });
  assert.equal(sent.status, 201);
  assert.equal(db.collections.chatMessages.rows.length, 1);
  const duplicate = await jsonRequest(base, accessTokens.parent, `/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body: 'Please share the homework notes.', clientMessageId }),
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.data.duplicate, true);
  assert.equal(db.collections.chatMessages.rows.length, 1);

  const teacherCannotOpenOtherPair = await jsonRequest(base, accessTokens.otherTeacher, `/conversations/${conversationId}/messages`);
  assert.equal(teacherCannotOpenOtherPair.status, 404);
  const history = await jsonRequest(base, accessTokens.teacher, `/conversations/${conversationId}/messages`);
  assert.ok(await canAccessConversation(db, actors[accessTokens.teacher], db.collections.chatConversations.rows[0]));
  assert.equal(history.status, 200, JSON.stringify(history.body));
  assert.equal(history.body.data.messages[0].body, 'Please share the homework notes.');

  const reply = await jsonRequest(base, accessTokens.teacher, `/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body: 'I will send them shortly.', clientMessageId: 'teacher-message-id-00000001' }),
  });
  assert.equal(reply.status, 201);
  const read = await jsonRequest(base, accessTokens.parent, `/conversations/${conversationId}/read`, { method: 'POST' });
  assert.equal(read.status, 200);
  assert.equal(read.body.data.markedRead, 1);
  assert.equal(db.collections.chatMessages.rows[1].readReceipts[0].userId, 'parent-user');
  const conversations = await jsonRequest(base, accessTokens.parent, '/conversations');
  assert.equal((await getVerifiedChildren(db, db.collections.users.rows.find(row => row.id === 'parent-user'), north)).length, 1);
  assert.equal((await authorizedPairs(db, actors[accessTokens.parent], '')).length, 1);
  assert.equal(conversations.body.data.conversations[0].unreadCount, 0);
});

test('revoked parent links and teacher assignments immediately deny chat history', async () => {
  for (const scenario of [
    {
      token: accessTokens.parent,
      revoke(db) {
        db.collections.parentChildLinks.rows[0].status = 'revoked';
        db.collections.parentChildLinks.rows[0].revokedAt = new Date();
      },
    },
    {
      token: accessTokens.teacher,
      revoke(db) {
        db.collections.classTeacherAssignments.rows[0].status = 'revoked';
        db.collections.classTeacherAssignments.rows[0].active = false;
      },
    },
  ]) {
    const db = makeDatabase();
    const server = createTestServer(db);
    const port = await listen(server);
    const base = `http://127.0.0.1:${port}/api/chat`;
    try {
      const started = await jsonRequest(base, accessTokens.parent, '/conversations', {
        method: 'POST',
        body: JSON.stringify({ studentId: '002', teacherId: 'teacher-a' }),
      });
      assert.equal(started.status, 201);

      scenario.revoke(db);
      const history = await jsonRequest(
        base,
        scenario.token,
        `/conversations/${started.body.data.id}/messages`,
      );
      assert.equal(history.status, 404);
    } finally {
      await close(server);
    }
  }
});

test('chat accepts only size-bounded images and protects attachment access by conversation', async t => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
  assert.equal(validateChatAttachment({ originalname: 'family.png', mimetype: 'image/png', size: png.length, buffer: png }).error, undefined);
  assert.ok(validateChatAttachment({ originalname: 'family.png', mimetype: 'image/jpeg', size: png.length, buffer: png }).error);
  assert.ok(validateChatAttachment({ originalname: 'family.pdf', mimetype: 'application/pdf', size: png.length, buffer: png }).error);
  assert.ok(validateChatAttachment({ originalname: 'family.png', mimetype: 'image/png', size: MAX_CHAT_ATTACHMENT_BYTES + 1, buffer: png }).error);

  const db = makeDatabase();
  const server = createTestServer(db);
  const port = await listen(server);
  t.after(() => close(server));
  const base = `http://127.0.0.1:${port}/api/chat`;
  const started = await jsonRequest(base, accessTokens.parent, '/conversations', {
    method: 'POST',
    body: JSON.stringify({ studentId: '002', teacherId: 'teacher-a' }),
  });
  const conversationId = started.body.data.id;
  const path = `/conversations/${conversationId}/attachments`;
  const sent = await imageRequest(base, accessTokens.parent, path, {
    bytes: png,
    body: 'Here is the photo.',
    clientMessageId: 'image-message-client-id-000001',
  });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal(sent.body.data.message.body, 'Here is the photo.');
  assert.equal(sent.body.data.message.attachments[0].contentType, 'image/png');
  assert.equal(db.collections.chatMessages.rows.length, 1);
  assert.equal(db.collections.chatAttachments.rows.length, 1);

  const duplicate = await imageRequest(base, accessTokens.parent, path, {
    name: 'another.png',
    bytes: png,
    clientMessageId: 'image-message-client-id-000001',
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.data.duplicate, true);
  assert.equal(db.collections.chatMessages.rows.length, 1);
  assert.equal(db.collections.chatAttachments.rows.length, 1);

  const attachmentId = sent.body.data.message.attachments[0].id;
  const teacherResponse = await fetch(`${base}/attachments/${attachmentId}`, {
    headers: { Authorization: `Bearer ${accessTokens.teacher}` },
  });
  assert.equal(teacherResponse.status, 200);
  assert.equal(teacherResponse.headers.get('content-type'), 'image/png');
  assert.equal(teacherResponse.headers.get('cache-control'), 'private, no-store');
  assert.equal(Buffer.from(await teacherResponse.arrayBuffer()).equals(png), true);

  const otherParent = await fetch(`${base}/attachments/${attachmentId}`, {
    headers: { Authorization: `Bearer ${accessTokens.otherParent}` },
  });
  assert.equal(otherParent.status, 404);
  const finance = await fetch(`${base}/attachments/${attachmentId}`, {
    headers: { Authorization: `Bearer ${accessTokens.finance}` },
  });
  assert.equal(finance.status, 404);
  const spoofed = await imageRequest(base, accessTokens.parent, path, {
    name: 'not-image.png',
    type: 'image/png',
    bytes: Buffer.from('not an image'),
    clientMessageId: 'spoofed-image-message-id-000001',
  });
  assert.equal(spoofed.status, 400);
  assert.equal(db.collections.chatMessages.rows.length, 1);
  assert.equal(db.collections.chatAttachments.rows.length, 1);
  db.collections.parentChildLinks.rows[0].status = 'revoked';
  const revokedParent = await fetch(`${base}/attachments/${attachmentId}`, {
    headers: { Authorization: `Bearer ${accessTokens.parent}` },
  });
  assert.equal(revokedParent.status, 404);
});

test('WebSocket sessions are short-lived, one-use and tied to the live access session', async () => {
  const db = makeDatabase();
  const ticket = 'one-time-ticket-which-is-long-enough-for-validation';
  db.collections.chatSocketTickets.rows.push({
    tokenHash: hashToken(ticket),
    userId: 'parent-user',
    role: 'parent',
    accessTokenHash: hashToken(accessTokens.parent),
    expiresAt: new Date(Date.now() + 30_000),
  });
  assert.equal((await consumeChatSocketTicket(db, ticket)).id, 'parent-user');
  assert.equal(await consumeChatSocketTicket(db, ticket), null);

  const revokedTicket = `${ticket}-revoked`;
  db.collections.chatSocketTickets.rows.push({
    tokenHash: hashToken(revokedTicket),
    userId: 'parent-user',
    role: 'parent',
    accessTokenHash: hashToken(accessTokens.parent),
    expiresAt: new Date(Date.now() + 30_000),
  });
  db.collections.refreshTokens.rows.find(row => row.tokenHash === hashToken(accessTokens.parent)).revokedAt = new Date();
  assert.equal(await consumeChatSocketTicket(db, revokedTicket), null);
});

test('persisted chat messages are delivered to an authenticated live WebSocket', async t => {
  const db = makeDatabase();
  const server = createTestServer(db);
  const port = await listen(server);
  let socket;
  t.after(async () => {
    socket?.terminate();
    await close(server);
  });
  const base = `http://127.0.0.1:${port}/api/chat`;
  const conversation = await jsonRequest(base, accessTokens.parent, '/conversations', {
    method: 'POST',
    body: JSON.stringify({ studentId: '002', teacherId: 'teacher-a' }),
  });
  const ticketResponse = await jsonRequest(base, accessTokens.teacher, '/session', { method: 'POST' });
  assert.equal(ticketResponse.status, 201);

  socket = new WebSocket(`ws://127.0.0.1:${port}/api/chat/socket`, 'school-chat-v1');
  const receivedReady = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WebSocket authentication timed out.')), 2000);
    socket.on('open', () => socket.send(JSON.stringify({ type: 'authenticate', ticket: ticketResponse.body.data.ticket })));
    socket.on('message', data => {
      const event = JSON.parse(String(data));
      if (event.type === 'ready') {
        clearTimeout(timeout);
        resolve();
      }
    });
    socket.on('error', reject);
  });
  await receivedReady;
  const delivered = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Live chat event was not delivered.')), 2000);
    socket.on('message', data => {
      const event = JSON.parse(String(data));
      if (event.type === 'message.created') {
        clearTimeout(timeout);
        resolve(event);
      }
    });
  });
  const sent = await jsonRequest(base, accessTokens.parent, `/conversations/${conversation.body.data.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body: 'Live delivery test.', clientMessageId: 'live-delivery-client-id-0001' }),
  });
  assert.equal(sent.status, 201);
  const event = await delivered;
  assert.equal(event.message.id, sent.body.data.message.id);
  assert.equal(event.message.body, 'Live delivery test.');
});

test('integrated chat uses current partner assignments and ObjectId branch/section scope', async () => {
  const previous = process.env.INTEGRATED_STAFF_ENABLED;
  process.env.INTEGRATED_STAFF_ENABLED = 'true';
  try {
    const {listAssignedTeachers} = require('./chatService');
    const db = makeDatabase();
    const student = db.collections.students.rows[0];
    student.classId = new ObjectId(); student.sectionId = new ObjectId(); student.branchId = northBranch;
    const teacher = db.collections.users.rows.find(row => row.id === 'teacher-a');
    teacher._id = new ObjectId(); teacher.branchId = northBranch; teacher.isActive = true;
    const assignment = {teacherId: teacher._id, branchId: northBranch, classId: student.classId, sectionId: student.sectionId,
      isActive: true, validFrom: new Date(Date.now() - 1000)};
    db.collections.teacherassignments = new MemoryCollection([assignment]);
    assert.equal((await listAssignedTeachers(db, student))[0].id, 'teacher-a');
    assignment.validUntil = new Date(Date.now() - 1);
    assert.equal((await listAssignedTeachers(db, student)).length, 0);
    assignment.validUntil = undefined; assignment.sectionId = new ObjectId();
    assert.equal((await listAssignedTeachers(db, student)).length, 0);
    assignment.sectionId = student.sectionId; assignment.branchId = southBranch;
    assert.equal((await listAssignedTeachers(db, student)).length, 0);
    assignment.branchId = northBranch; teacher.isActive = false;
    assert.equal((await listAssignedTeachers(db, student)).length, 0);
    teacher.isActive = true; assignment.isActive = false;
    assert.equal((await listAssignedTeachers(db, student)).length, 0);
  } finally {
    if (previous === undefined) delete process.env.INTEGRATED_STAFF_ENABLED;
    else process.env.INTEGRATED_STAFF_ENABLED = previous;
  }
});
