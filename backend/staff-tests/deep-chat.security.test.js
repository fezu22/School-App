const {before, beforeEach, afterEach, after, test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {MongoMemoryReplSet} = require('mongodb-memory-server');
const {MongoClient, ObjectId} = require('mongodb');
const WebSocket = require('ws');
let repl, client, db, activeDb, server, base, realtime, chat;
let school, branch, foreignSchool, teacher, student, parent, secondTeacher, learner, conversation;
const sockets = new Set();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const identity = actor => actor.record.id || String(actor.record._id);
before(async () => {
  repl = await MongoMemoryReplSet.create({replSet: {count: 1}});
  client = new MongoClient(repl.getUri()); await client.connect();
  db = client.db('deep_chat_owned'); activeDb = db;
  const dotenvPath = require.resolve('dotenv');
  require.cache[dotenvPath] = {id: dotenvPath, filename: dotenvPath, loaded: true, exports: {config: () => ({parsed: {}})}};
  const databasePath = require.resolve('../src/database');
  require.cache[databasePath] = {id: databasePath, filename: databasePath, loaded: true, exports: {
    getDatabase: () => activeDb, getClient: () => client,
    connectDatabase: () => {throw new Error('Production startup is forbidden in deep tests');},
  }};
  process.env.INTEGRATED_STAFF_ENABLED = 'true';
  process.env.ONLINE_PAYMENTS_VERIFIED = 'false';
  process.env.LIVE_LESSONS_VERIFIED = 'false';
  process.env.LIVE_LESSON_ENABLED = 'false';
  chat = require('../src/chatRoutes');
  await chat.initializeChatIndexes(() => db);
  server = require('../src/server').createApplication().listen(0, '127.0.0.1');
  realtime = require('../src/chatRealtime').attachChatRealtime(server, {getDb: () => activeDb, sessionCheckIntervalMs: 250});
  require('../src/routes').setChatRealtimePublisher(realtime.publish);
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
async function actor(role, name, extra = {}) {
  const record = {_id: new ObjectId(), id: name, role, schoolId: school, branchId: String(branch), active: true, isActive: true, fullName: 'Owned ' + name, email: name + '@test.invalid', ...extra};
  await db.collection('users').insertOne(record);
  const token = crypto.randomBytes(32).toString('base64url');
  const sessionId = new ObjectId();
  await db.collection('refreshTokens').insertOne({_id: sessionId, tokenHash: hash(token), userId: identity({record}), type: 'access', revokedAt: null, expiresAt: new Date(Date.now() + 3600000)});
  return {record, token, sessionId};
}
beforeEach(async () => {
  activeDb = db;
  assert.equal(db.databaseName, 'deep_chat_owned');
  for (const collection of await db.collections()) await collection.deleteMany({});
  school = new ObjectId(); foreignSchool = new ObjectId(); branch = new ObjectId();
  await db.collection('schools').insertMany([{_id: school, isActive: true}, {_id: foreignSchool, isActive: true}]);
  await db.collection('branches').insertOne({_id: branch, schoolId: school, isActive: true});
  teacher = await actor('teacher', 'deep-teacher'); secondTeacher = await actor('teacher', 'deep-teacher-2');
  student = await actor('student', 'deep-student'); parent = await actor('parent', 'deep-parent');
  const classId = new ObjectId(), sectionId = new ObjectId();
  learner = {_id: new ObjectId(), id: 'deep-learner', userId: student.record.id, fullName: 'Owned learner', classId, sectionId, branchId: branch, schoolId: school};
  await db.collection('students').insertOne(learner);
  await db.collection('teacherassignments').insertMany([teacher, secondTeacher].map(person => ({teacherId: person.record._id, branchId: branch, classId, sectionId, isActive: true, revokedAt: null, validFrom: new Date(Date.now() - 60000)})));
  await db.collection('parentChildLinks').insertOne({studentId: learner.id, parentUserId: parent.record.id, status: 'verified', revokedAt: null});
  conversation = await createConversation(teacher);
});
afterEach(async () => {
  await Promise.all([...sockets].map(socket => new Promise(resolve => {
    if (socket.readyState === WebSocket.CLOSED) return resolve();
    socket.once('close', resolve); socket.terminate();
  })));
  sockets.clear(); activeDb = db;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (client) await client.close();
  if (repl) await repl.stop();
});
async function http(path, person, body) {
  const result = await fetch(base + '/api' + path, {method: body === undefined ? 'GET' : 'POST', headers: {
    ...(person ? {Authorization: 'Bearer ' + person.token} : {}), ...(body === undefined ? {} : {'Content-Type': 'application/json'}),
  }, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  const text = await result.text();
  return {status: result.status, data: JSON.parse(text), text};
}
async function createConversation(person) {
  const result = await http('/chat/conversations', student, {studentId: learner.id, teacherId: identity(person)});
  assert.equal(result.status, 201, result.text);
  return db.collection('chatConversations').findOne({id: result.data.data.id});
}
async function ticket(person) {
  const result = await http('/chat/session', person, {});
  assert.equal(result.status, 201, result.text); return result.data.data.ticket;
}
function outcome(socket, accept = () => true, timeoutMs = 6000) {
  const pending = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {clean(); reject(new Error('Expected WebSocket outcome did not arrive'));}, timeoutMs);
    function clean() {clearTimeout(timer); socket.off('message', message); socket.off('close', close); socket.off('error', error);}
    function message(bytes) {const event = JSON.parse(String(bytes)); if (accept(event)) {clean(); resolve({kind: 'message', event});}}
    function close(code) {clean(); resolve({kind: 'close', code});}
    function error(err) {clean(); reject(err);}
    socket.on('message', message); socket.on('close', close); socket.on('error', error);
  });
  // Register a rejection handler immediately while concurrent HTTP work runs;
  // the awaited original promise still propagates the failure to the test.
  pending.catch(() => {});
  return pending;
}
async function openWithTicket(value, duplicate = false) {
  const socket = new WebSocket(base.replace('http:', 'ws:') + '/api/chat/socket', 'school-chat-v1');
  sockets.add(socket); socket.events = [];
  socket.on('message', bytes => socket.events.push(JSON.parse(String(bytes))));
  const first = outcome(socket);
  socket.on('open', () => {
    socket.send(JSON.stringify({type: 'authenticate', ticket: value}));
    if (duplicate) socket.send(JSON.stringify({type: 'authenticate', ticket: value}));
  });
  return {socket, first: await first};
}
async function connected(person) {
  const opened = await openWithTicket(await ticket(person));
  assert.equal(opened.first.event?.type, 'ready', JSON.stringify(opened.first));
  return opened.socket;
}
const event = () => ({type: 'message.created', conversationId: conversation.id, message: {id: crypto.randomUUID(), body: 'Owned protected fixture'}});
async function pushed(socket, mutate, expectClose = true) {
  const next = outcome(socket, value => ['message.created', 'pong'].includes(value.type));
  await mutate();
  await realtime.publish(event(), conversation);
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({type: 'ping'}));
  const result = await next;
  if (expectClose) {assert.equal(result.kind, 'close', JSON.stringify(result)); assert.equal(result.code, 1008);}
  else assert.equal(result.event?.type, 'pong', JSON.stringify(result));
  assert.equal(socket.events.some(value => value.type === 'message.created'), false);
}
test('DEEP-01 production HTTP publisher delivers the persisted message through default wiring', async () => {
  const socket = await connected(teacher);
  const next = outcome(socket, value => value.type === 'message.created');
  const sent = await http(`/chat/conversations/${conversation.id}/messages`, student, {body: 'Production path delivery', clientMessageId: 'production-path-message-0001'});
  assert.equal(sent.status, 201, sent.text);
  assert.equal((await next).event?.message.id, sent.data.data.message.id);
});
test('DEEP-02 direct publisher positive control delivers to a currently authorized socket', async () => {
  const socket = await connected(teacher); const next = outcome(socket, value => value.type === 'message.created');
  await realtime.publish(event(), conversation); assert.equal((await next).event?.type, 'message.created');
});
test('DEEP-03 canonical ObjectId branch values retain realtime delivery', async () => {
  await db.collection('users').updateOne({_id: teacher.record._id}, {$set: {branchId: branch}});
  const socket = await connected(teacher); const next = outcome(socket, value => value.type === 'message.created');
  await realtime.publish(event(), conversation); assert.equal((await next).event?.type, 'message.created');
});
test('DEEP-04 native teacher identity without a legacy alias can authenticate and receive', async () => {
  await db.collection('users').updateOne({_id: teacher.record._id}, {$unset: {id: ''}}); delete teacher.record.id;
  await db.collection('refreshTokens').updateOne({_id: teacher.sessionId}, {$set: {userId: identity(teacher)}});
  conversation = await createConversation(teacher);
  const socket = await connected(teacher); const next = outcome(socket, value => value.type === 'message.created');
  await realtime.publish(event(), conversation); assert.equal((await next).event?.type, 'message.created');
});
test('DEEP-05 canonical parent-child ObjectId references retain authorized delivery', async () => {
  await db.collection('parentChildLinks').updateOne({}, {$set: {studentId: learner._id, parentUserId: parent.record._id}});
  const socket = await connected(parent); const next = outcome(socket, value => value.type === 'message.created');
  await realtime.publish(event(), conversation); assert.equal((await next).event?.type, 'message.created');
});
test('DEEP-06 logout after socket readiness prevents further protected delivery', async () => {
  const socket = await connected(teacher);
  await pushed(socket, async () => assert.equal((await http('/auth/logout', teacher, {})).status, 200));
});
test('DEEP-07 expired session after readiness cannot receive a protected event', async () => {
  const socket = await connected(teacher); await pushed(socket, () => db.collection('refreshTokens').updateOne({_id: teacher.sessionId}, {$set: {expiresAt: new Date(0)}}));
});
for (const [number, flag] of [[8, 'active'], [9, 'isActive']]) test(`DEEP-${String(number).padStart(2, '0')} ${flag} disable after readiness closes the session`, async () => {
  const socket = await connected(teacher); await pushed(socket, () => db.collection('users').updateOne({_id: teacher.record._id}, {$set: {[flag]: false}}));
});
test('DEEP-10 school suspension after readiness prevents protected delivery', async () => {
  const socket = await connected(teacher); await pushed(socket, () => db.collection('schools').updateOne({_id: school}, {$set: {status: 'suspended'}}));
});
test('DEEP-11 branch school mismatch after readiness invalidates the socket', async () => {
  const socket = await connected(teacher); await pushed(socket, () => db.collection('branches').updateOne({_id: branch}, {$set: {schoolId: foreignSchool}}));
});
test('DEEP-12 changed role after readiness requires fresh authentication', async () => {
  const socket = await connected(teacher); await pushed(socket, () => db.collection('users').updateOne({_id: teacher.record._id}, {$set: {role: 'student'}}));
});
test('DEEP-13 idle revoked socket is closed without waiting for a new chat message', async () => {
  const socket = await connected(teacher); const next = outcome(socket, () => false, 2500);
  await db.collection('refreshTokens').updateOne({_id: teacher.sessionId}, {$set: {revokedAt: new Date()}});
  assert.equal((await next).code, 1008);
});
test('DEEP-14 account disabled between ticket issuance and socket open is denied', async () => {
  const value = await ticket(teacher); await db.collection('users').updateOne({_id: teacher.record._id}, {$set: {isActive: false}});
  assert.equal((await openWithTicket(value)).first.kind, 'close');
});
test('DEEP-15 school suspended between ticket issuance and socket open is denied', async () => {
  const value = await ticket(teacher); await db.collection('schools').updateOne({_id: school}, {$set: {status: 'suspended'}});
  assert.equal((await openWithTicket(value)).first.kind, 'close');
});
test('DEEP-16 ambiguous native ID and legacy alias cannot redeem a socket ticket', async () => {
  await db.collection('users').updateOne({_id: teacher.record._id}, {$unset: {id: ''}}); delete teacher.record.id;
  await db.collection('refreshTokens').updateOne({_id: teacher.sessionId}, {$set: {userId: identity(teacher)}});
  const value = await ticket(teacher);
  await db.collection('users').insertOne({_id: new ObjectId(), id: identity(teacher), role: 'teacher', branchId: String(branch), schoolId: school, active: true, isActive: true});
  assert.equal((await openWithTicket(value)).first.kind, 'close');
});
test('DEEP-17 twenty simultaneous ticket redemptions have exactly one winner', async () => {
  const value = await ticket(teacher);
  const results = await Promise.all(Array.from({length: 20}, () => chat.consumeChatSocketTicket(db, value)));
  assert.equal(results.filter(Boolean).length, 1);
});
test('DEEP-18 overlapping authentication frames fail closed before readiness', async () => {
  const opened = await openWithTicket(await ticket(teacher), true);
  if (opened.first.kind !== 'close') assert.equal((await outcome(opened.socket, () => false)).kind, 'close');
  assert.equal(opened.socket.events.filter(value => value.type === 'ready').length, 0);
});
test('DEEP-19 malformed WebSocket JSON closes with a protocol error', async () => {
  const socket = await connected(teacher); const next = outcome(socket, () => false);
  socket.send('{invalid'); assert.equal((await next).code, 1003);
});
test('DEEP-20 oversized WebSocket frames are rejected before application handling', async () => {
  const socket = await connected(teacher); const next = outcome(socket, () => false);
  socket.send('x'.repeat(9000)); assert.equal((await next).code, 1009);
});
test('DEEP-21 revoked parent-child relationship cannot receive further conversation data', async () => {
  const socket = await connected(parent); await pushed(socket, () => db.collection('parentChildLinks').updateOne({}, {$set: {status: 'revoked', revokedAt: new Date()}}), false);
});
test('DEEP-22 revoked teacher assignment cannot receive further conversation data', async () => {
  const socket = await connected(teacher); await pushed(socket, () => db.collection('teacherassignments').updateOne({teacherId: teacher.record._id}, {$set: {isActive: false}}), false);
});
test('DEEP-23 logout committed during recipient authorization wins before delivery', async () => {
  const socket = await connected(teacher); let revoked = false;
  activeDb = {collection(name) {
    const collection = db.collection(name);
    if (name !== 'students') return collection;
    return new Proxy(collection, {get(target, key) {
      if (key === 'find') return (...args) => {
        const cursor = target.find(...args); const original = cursor.toArray.bind(cursor);
        cursor.toArray = async () => {const rows = await original(); if (!revoked) {revoked = true; await db.collection('refreshTokens').updateOne({_id: teacher.sessionId}, {$set: {revokedAt: new Date()}});} return rows;};
        return cursor;
      };
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
    }});
  }};
  await pushed(socket, async () => {}); assert.equal(revoked, true);
});
test('DEEP-24 image attachment round-trips through real MongoDB binary storage', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGZkAAAAASUVORK5CYII=', 'base64');
  const form = new FormData(); form.set('file', new Blob([png], {type: 'image/png'}), 'owned.png'); form.set('clientMessageId', 'deep-image-message-id-0001');
  const upload = await fetch(base + `/api/chat/conversations/${conversation.id}/attachments`, {method: 'POST', headers: {Authorization: 'Bearer ' + student.token}, body: form});
  const value = await upload.json(); assert.equal(upload.status, 201, JSON.stringify(value));
  const download = await fetch(base + '/api/chat/attachments/' + value.data.message.attachments[0].id, {headers: {Authorization: 'Bearer ' + teacher.token}});
  assert.equal(download.status, 200); assert.deepEqual(Buffer.from(await download.arrayBuffer()), png);
});
test('DEEP-25 twenty simultaneous identical message retries persist one message and emit once', async () => {
  const socket = await connected(teacher); const next = outcome(socket, value => value.type === 'message.created');
  const results = await Promise.all(Array.from({length: 20}, () => http(`/chat/conversations/${conversation.id}/messages`, student, {body: 'One logical message', clientMessageId: 'deep-parallel-message-0001'})));
  assert.equal(results.filter(result => result.status === 201).length, 1);
  assert.equal(results.filter(result => result.status === 200).length, 19);
  assert.equal(await db.collection('chatMessages').countDocuments(), 1);
  assert.equal((await next).event?.type, 'message.created');
  const barrier = outcome(socket, value => value.type === 'pong'); socket.send(JSON.stringify({type: 'ping'})); await barrier;
  assert.equal(socket.events.filter(value => value.type === 'message.created').length, 1);
});
test('DEEP-26 changed message payload cannot silently reuse an idempotency identity', async () => {
  const path = `/chat/conversations/${conversation.id}/messages`, clientMessageId = 'deep-changed-payload-0001';
  assert.equal((await http(path, student, {body: 'Original', clientMessageId})).status, 201);
  assert.equal((await http(path, student, {body: 'Changed', clientMessageId})).status, 409);
  assert.equal((await db.collection('chatMessages').findOne({clientMessageId})).body, 'Original');
});
test('DEEP-27 concurrent cross-conversation message identity collision returns a clean conflict', async () => {
  const other = await createConversation(secondTeacher); let waiting = 0, release;
  const barrier = new Promise(resolve => {release = resolve;});
  activeDb = {collection(name) {
    const collection = db.collection(name);
    if (name !== 'chatMessages') return collection;
    return new Proxy(collection, {get(target, key) {
      if (key === 'findOne') return async (...args) => {const row = await target.findOne(...args); if (args[0].clientMessageId === 'deep-cross-conversation-0001' && waiting < 2) {if (++waiting === 2) release(); await barrier;} return row;};
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
    }});
  }};
  const results = await Promise.all([conversation, other].map(row => http(`/chat/conversations/${row.id}/messages`, student, {body: 'Concurrent collision', clientMessageId: 'deep-cross-conversation-0001'})));
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  assert.equal(await db.collection('chatMessages').countDocuments(), 1);
});
test('DEEP-28 history pagination keeps identical timestamps stable without duplicates or omissions', async () => {
  const createdAt = new Date();
  await db.collection('chatMessages').insertMany(Array.from({length: 101}, (_, i) => ({_id: new ObjectId(), id: 'history-' + i, conversationId: conversation.id, senderUserId: identity(student), senderRole: 'student', body: 'Owned ' + i, createdAt, clientMessageId: 'history-client-' + String(i).padStart(16, '0')})));
  const ids = []; let cursor;
  do {
    const page = await http(`/chat/conversations/${conversation.id}/messages` + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''), teacher);
    assert.equal(page.status, 200, page.text); ids.push(...page.data.data.messages.map(row => row.id)); cursor = page.data.data.nextCursor;
  } while (cursor);
  assert.equal(ids.length, 101); assert.equal(new Set(ids).size, 101);
});
test('DEEP-29 clients cannot subscribe to arbitrary conversation identifiers', async () => {
  const socket = await connected(teacher); const next = outcome(socket, () => false);
  socket.send(JSON.stringify({type: 'subscribe', conversationId: 'foreign-conversation'})); assert.equal((await next).code, 1008);
});
test('DEEP-30 readiness payload exposes no bearer or session hash', async () => {
  const socket = await connected(teacher); assert.deepEqual(socket.events[0], {type: 'ready'});
});
test('DEEP-31 bounded send queue closes a slow consumer instead of accumulating data', async () => {
  const socket = await connected(teacher);
  const peer = [...realtime.websocketServer.clients].find(value => value.user?.id === identity(teacher));
  assert.ok(peer);
  // Deterministic transport-boundary fault injection, not a bandwidth/load test.
  Object.defineProperty(peer, 'bufferedAmount', {configurable: true, get: () => 1024 * 1024});
  const next = outcome(socket, () => false); await realtime.publish(event(), conversation);
  assert.equal((await next).code, 1013);
});
test('DEEP-32 binary application frames cannot bypass the text JSON protocol', async () => {
  const socket = await connected(teacher); const next = outcome(socket, () => false);
  socket.send(Buffer.from(JSON.stringify({type: 'ping'}))); assert.equal((await next).code, 1003);
});
test('DEEP-33 corrupted null session identity cannot match an alias-free native user', async () => {
  await db.collection('users').updateOne({_id: teacher.record._id}, {$unset: {id: ''}});
  await db.collection('refreshTokens').updateOne({_id: teacher.sessionId}, {$set: {userId: null}});
  assert.equal((await http('/auth/me', teacher)).status, 401);
});
test('DEEP-34 legacy parent-child aliases retain authorized realtime delivery', async () => {
  const socket = await connected(parent); const next = outcome(socket, value => value.type === 'message.created');
  await realtime.publish(event(), conversation); assert.equal((await next).event?.type, 'message.created');
});
test('DEEP-35 unrelated broken Parent references do not suppress other authorized recipients', async () => {
  await db.collection('parentChildLinks').insertOne({studentId: learner.id, parentUserId: 'unresolved-owned-fixture', status: 'verified', revokedAt: null});
  const socket = await connected(teacher); const next = outcome(socket, value => value.type === 'message.created');
  await realtime.publish(event(), conversation); assert.equal((await next).event?.type, 'message.created');
});
