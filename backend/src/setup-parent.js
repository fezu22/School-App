const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const readline = require('node:readline');
const { connectDatabase, closeDatabase, getDatabase } = require('./database');
const { hashPassword, login, logout, normalizeEmail } = require('./auth');

const STUDENT_ID = 'Student 002';

function ask(prompt) {
  return new Promise(resolve => {
    const input = readline.createInterface({ input: process.stdin, output: process.stdout });
    input.question(prompt, answer => { input.close(); resolve(answer.trim()); });
  });
}

function askHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) return reject(new Error('A TTY is required for the hidden password prompt.'));
    process.stdout.write(prompt);
    const wasRaw = process.stdin.isRaw;
    let value = '';
    const cleanup = () => { process.stdin.off('data', onData); process.stdin.setRawMode(wasRaw || false); process.stdin.pause(); };
    const onData = chunk => {
      const key = chunk.toString('utf8');
      if (key === '\u0003') { cleanup(); reject(new Error('Password entry cancelled.')); }
      else if (key === '\r' || key === '\n') { cleanup(); process.stdout.write('\n'); resolve(value); }
      else if (key === '\u007f') value = value.slice(0, -1);
      else if (key >= ' ') value += key;
    };
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on('data', onData);
  });
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`Usage: npm run setup:parent\nLinks the new Parent account to existing ${STUDENT_ID}.`);
    return;
  }
  console.log(`Create one real Parent account linked to existing ${STUDENT_ID}.`);
  const fullName = await ask('Parent full name: ');
  const email = normalizeEmail(await ask('Parent email: '));
  const password = await askHidden('Password (hidden, minimum 12 characters): ');
  if (!fullName || !email || password.length < 12) throw new Error('Name, email, and a password of at least 12 characters are required.');

  await connectDatabase();
  const db = getDatabase();
  const student = await db.collection('students').findOne({ id: STUDENT_ID });
  if (!student) throw new Error(`Existing student profile ${STUDENT_ID} was not found; no Parent records were created.`);
  if (await db.collection('users').findOne({ emailLower: email })) throw new Error('A user with this email already exists; no records were created.');

  const userId = `USR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { passwordHash, passwordSalt } = hashPassword(password);
  await db.collection('users').insertOne({ id: userId, email, emailLower: email, fullName, role: 'parent', passwordHash, passwordSalt, active: true, createdAt: new Date() });
  try {
    await db.collection('parents').insertOne({ id: userId, userId, fullName, studentIds: [STUDENT_ID], createdAt: new Date() });
    await db.collection('parentChildLinks').insertOne({ parentUserId: userId, studentId: STUDENT_ID, status: 'verified', verified: true, revokedAt: null, createdAt: new Date() });
  } catch (error) {
    await db.collection('parentChildLinks').deleteMany({ parentUserId: userId, studentId: STUDENT_ID });
    await db.collection('parents').deleteMany({ userId });
    await db.collection('users').deleteOne({ id: userId });
    throw error;
  }

  const session = await login(email, password);
  if (!session?.user?.id || session.user.id !== userId || session.user.role !== 'parent') throw new Error('Parent account was created but local login verification failed.');
  await logout(session.token);
  const counts = {
    users: await db.collection('users').countDocuments({ id: userId, role: 'parent' }),
    parents: await db.collection('parents').countDocuments({ userId }),
    links: await db.collection('parentChildLinks').countDocuments({ parentUserId: userId, studentId: STUDENT_ID, status: 'verified', revokedAt: null }),
  };
  console.log(`Created Parent account: ${email}`);
  console.log(`Parent User ID: ${userId}`);
  console.log(`Linked Student ID: ${STUDENT_ID}`);
  console.log('Local login verification: passed; session revoked.');
  console.log(`Verified documents in school_management: users=${counts.users}, parents=${counts.parents}, parentChildLinks=${counts.links}`);
}

main().catch(async error => { console.error(error.message); await closeDatabase(); process.exitCode = 1; });
