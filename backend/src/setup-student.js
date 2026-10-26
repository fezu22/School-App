const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const readline = require('node:readline');
const { connectDatabase, closeDatabase, getDatabase } = require('./database');
const { hashPassword, login, logout, normalizeEmail } = require('./auth');

function ask(prompt) {
  return new Promise((resolve) => {
    const input = readline.createInterface({ input: process.stdin, output: process.stdout });
    input.question(prompt, (answer) => { input.close(); resolve(answer.trim()); });
  });
}

function askHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) return reject(new Error('A TTY is required for the hidden password prompt.'));
    process.stdout.write(prompt);
    const wasRaw = process.stdin.isRaw;
    let value = '';
    const cleanup = () => { process.stdin.off('data', onData); process.stdin.setRawMode(wasRaw || false); process.stdin.pause(); };
    const onData = (chunk) => {
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
    console.log('Usage: npm run setup:student');
    console.log('Prompts for real Student profile details and a hidden password.');
    return;
  }
  console.log('Create one real Student account and profile. Do not enter demo data.');
  const email = normalizeEmail(await ask('Email: '));
  const fullName = await ask('Full name: ');
  const studentId = await ask('Student ID: ');
  const grade = await ask('Grade: ');
  const section = await ask('Section: ');
  const branchId = await ask('Branch ID: ');
  const password = await askHidden('Password (hidden, minimum 12 characters): ');
  if (!email || !fullName || !studentId || !grade || !section || !branchId) throw new Error('All requested profile fields are required.');
  if (password.length < 12) throw new Error('Password must be at least 12 characters.');

  await connectDatabase();
  const db = getDatabase();
  if (await db.collection('users').findOne({ emailLower: email })) throw new Error('A user with this email already exists.');
  if (await db.collection('students').findOne({ id: studentId })) throw new Error('A student profile with this Student ID already exists.');

  const userId = `USR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { passwordHash, passwordSalt } = hashPassword(password);
  await db.collection('users').insertOne({ id: userId, email, emailLower: email, fullName, role: 'student', branchId, passwordHash, passwordSalt, active: true, createdAt: new Date() });
  try {
    await db.collection('students').insertOne({ id: studentId, userId, name: fullName, fullName, grade, section, branchId, status: 'Active', createdAt: new Date() });
  } catch (error) {
    await db.collection('users').deleteOne({ id: userId });
    throw error;
  }

  const session = await login(email, password);
  if (!session?.user?.id || session.user.id !== userId || session.user.role !== 'student') throw new Error('Created account could not complete local login verification.');
  await logout(session.token);
  const userCount = await db.collection('users').countDocuments({ id: userId });
  const studentCount = await db.collection('students').countDocuments({ id: studentId, userId });
  console.log(`Created Student account: ${email}`);
  console.log(`User ID: ${userId}`);
  console.log(`Student profile ID: ${studentId}`);
  console.log(`Local login verification: passed; session revoked.`);
  console.log(`Verified documents in school_management: users=${userCount}, students=${studentCount}`);
}

main().catch(async (error) => { console.error(error.message); await closeDatabase(); process.exitCode = 1; });
