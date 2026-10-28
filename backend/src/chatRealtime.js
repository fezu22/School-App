const WebSocket = require('ws');
const {getDatabase} = require('./database');
const {canAccessConversation, sameBranchId, verifiedLinkFilter} = require('./chatService');
const {consumeChatSocketTicket} = require('./chatRoutes');
const {getSessionIdentity} = require('./auth');
const {apiId, resolveUserForRole, referenceFieldFilter} = require('./identityReferenceAdapter');
const MAX_SOCKET_BUFFER_BYTES = 1024 * 1024;

function send(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount >= MAX_SOCKET_BUFFER_BYTES) {
    socket.close(1013, 'Reconnect and reload message history'); return;
  }
  socket.send(JSON.stringify(payload));
}

function attachChatRealtime(server, {getDb = getDatabase, sessionCheckIntervalMs = 15000} = {}) {
  const websocketServer = new WebSocket.Server({noServer: true, maxPayload: 8192});
  const clientsByUser = new Map();
  const bindings = new WeakMap();
  const states = new WeakMap();
  function deny(client, code = 1008, message = 'Session expired or access changed') {
    states.set(client, 'closing');
    if (client.readyState === WebSocket.OPEN) client.close(code, message);
  }
  function sameIdentity(binding, identity) {
    return binding.id === identity.user.id && binding.role === identity.user.role &&
      String(binding.branchId || '') === String(identity.user.branchId || '') &&
      String(binding.schoolId || '') === String(identity.record.schoolId || '');
  }
  async function current(client) {
    const binding = bindings.get(client);
    if (!binding || states.get(client) !== 'authenticated' || client.readyState !== WebSocket.OPEN) return null;
    try {
      const identity = await getSessionIdentity(getDb(), binding.accessTokenHash, {userId: binding.sessionUserId, role: binding.role});
      if (!identity || !sameIdentity(binding, identity)) {deny(client); return null;}
      if (states.get(client) !== 'authenticated' || client.readyState !== WebSocket.OPEN) return null;
      return identity.user;
    } catch {deny(client); return null;}
  }
  server.on('upgrade', (request, socket, head) => {
    let pathname;
    try {pathname = new URL(request.url, 'http://localhost').pathname;}
    catch {socket.destroy(); return;}
    if (pathname !== '/api/chat/socket') return;
    websocketServer.handleUpgrade(request, socket, head, client => websocketServer.emit('connection', client, request));
  });
  websocketServer.on('connection', client => {
    states.set(client, 'waiting');
    const authTimeout = setTimeout(() => {
      if (states.get(client) !== 'authenticated') deny(client, 1008, 'Authentication required');
    }, 5000);
    authTimeout.unref?.();
    async function handle(raw, binary) {
      if (binary) {deny(client, 1003, 'Text JSON is required'); return;}
      let event;
      try {event = JSON.parse(String(raw));}
      catch {deny(client, 1003, 'Invalid event'); return;}
      const state = states.get(client);
      if (state === 'authenticating') {deny(client, 1008, 'Authentication already in progress'); return;}
      if (state === 'waiting') {
        if (event?.type !== 'authenticate' || typeof event.ticket !== 'string') {deny(client, 1008, 'Authentication required'); return;}
        // Reserve authentication before awaiting MongoDB. A second frame or a
        // disconnect must not register an already-closing socket later.
        states.set(client, 'authenticating');
        const user = await consumeChatSocketTicket(getDb(), event.ticket);
        if (states.get(client) !== 'authenticating' || client.readyState !== WebSocket.OPEN) return;
        if (!user) {deny(client); return;}
        const verified = await getSessionIdentity(getDb(), user.accessTokenHash, {userId: user.sessionUserId, role: user.role});
        if (states.get(client) !== 'authenticating' || client.readyState !== WebSocket.OPEN) return;
        if (!verified || !sameIdentity(user, verified)) {deny(client); return;}
        bindings.set(client, user);
        states.set(client, 'authenticated');
        clearTimeout(authTimeout);
        const sockets = clientsByUser.get(user.id) || new Set(); sockets.add(client); clientsByUser.set(user.id, sockets);
        // The internal token hash remains in a WeakMap, never in public events.
        client.user = verified.user;
        send(client, {type: 'ready'}); return;
      }
      if (state !== 'authenticated') return;
      if (!(await current(client))) return;
      if (event?.type === 'ping') send(client, {type: 'pong'});
      else deny(client, 1008, 'Unsupported event');
    }
    client.on('message', (raw, binary) => {void handle(raw, binary).catch(() => deny(client));});
    client.on('close', () => {
      clearTimeout(authTimeout); states.set(client, 'closed');
      const user = bindings.get(client);
      if (user) {
        const sockets = clientsByUser.get(user.id); sockets?.delete(client);
        if (sockets?.size === 0) clientsByUser.delete(user.id);
        bindings.delete(client);
      }
    });
    client.on('error', () => {});
    client.isAlive = true;
    client.on('pong', () => {client.isAlive = true;});
  });
  const heartbeat = setInterval(() => {
    for (const client of websocketServer.clients) {
      if (client.isAlive === false) {client.terminate(); continue;}
      client.isAlive = false; client.ping();
    }
  }, 30000);
  heartbeat.unref?.();
  let checking = false;
  const sessionChecks = setInterval(() => {
    if (checking) return;
    checking = true;
    Promise.allSettled([...websocketServer.clients].map(current)).finally(() => {checking = false;});
  }, Math.max(100, Number(sessionCheckIntervalMs) || 15000));
  sessionChecks.unref?.();

  async function recipientsFor(conversation) {
    if (!conversation?.id) return [];
    const db = getDb();
    try {
      const teacher = await resolveUserForRole(db, conversation.teacherUserId, 'teacher');
      if (teacher.active === false || teacher.isActive === false) return [];
      const teacherId = String(apiId(teacher));
      const teacherSchoolId = teacher.schoolId ? String(teacher.schoolId) : undefined;
      const access = await canAccessConversation(
        db,
        { id: teacherId, role: 'teacher', branchId: teacher.branchId, schoolId: teacherSchoolId },
        conversation,
      );
      if (!access) return [];
      const recipients = new Set([teacherId]);
      const student = access.student;
      const studentSchoolId = student.schoolId ? String(student.schoolId) : teacherSchoolId;
      const learner = await resolveUserForRole(db, student.userId, 'student');
      if (
        learner.active !== false &&
        learner.isActive !== false &&
        sameBranchId(learner.branchId, student.branchId) &&
        String(learner.schoolId || '') === String(studentSchoolId || '')
      ) {
        recipients.add(String(apiId(learner)));
      }
      const linkFilter = {
        ...(student.tenantScope?.schoolFilter || {}),
        ...verifiedLinkFilter(null, null),
        ...referenceFieldFilter('studentId', student),
      };
      delete linkFilter.parentUserId;
      const links = await db.collection('parentChildLinks').find(linkFilter).toArray();
      for (const link of links) {
        try {
          const parent = await resolveUserForRole(db, link.parentUserId, 'parent');
          if (
            parent.active !== false &&
            parent.isActive !== false &&
            sameBranchId(parent.branchId, student.branchId) &&
            String(parent.schoolId || '') === String(studentSchoolId || '')
          ) {
            recipients.add(String(apiId(parent)));
          }
        } catch { /* A broken Parent reference grants no access and must not disable other authorized recipients. */ }
      }
      return [...recipients];
    } catch {return [];}
  }
  async function publish(event, conversation) {
    const recipients = await recipientsFor(conversation);
    await Promise.all(recipients.flatMap(id => [...(clientsByUser.get(id) || [])]).map(async client => {
      const user = await current(client);
      if (!user) return;
      try {
        if (!(await canAccessConversation(getDb(), user, conversation))) return;
        // Recheck after the multi-query recipient authorization so logout,
        // expiry or account changes committed during that work win.
        if (!(await current(client))) return;
        send(client, event);
      } catch {deny(client);}
    }));
  }
  server.once('close', () => {
    clearInterval(heartbeat); clearInterval(sessionChecks);
    for (const client of websocketServer.clients) client.close(1001, 'Server closing');
    websocketServer.close();
  });
  return {publish, websocketServer};
}
module.exports = {attachChatRealtime};
