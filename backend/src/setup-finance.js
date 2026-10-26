const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const readline = require('node:readline');
const { connectDatabase, closeDatabase, getDatabase } = require('./database');
const { hashPassword, login, logout, normalizeEmail } = require('./auth');

function ask(prompt) {
  return new Promise(resolve => {
    const input = readline.createInterface({ input: process.stdin, output: process.stdout });
    input.question(prompt, answer => { input.close(); resolve(answer.trim()); });
  });
}
function askHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) return reject(new Error('A TTY is required for the hidden password prompt.'));
    process.stdout.write(prompt); const wasRaw = process.stdin.isRaw; let value = '';
    const cleanup = () => { process.stdin.off('data', onData); process.stdin.setRawMode(wasRaw || false); process.stdin.pause(); };
    const onData = chunk => { const key = chunk.toString('utf8'); if (key === '\u0003') { cleanup(); reject(new Error('Password entry cancelled.')); } else if (key === '\r' || key === '\n') { cleanup(); process.stdout.write('\n'); resolve(value); } else if (key === '\u007f') value = value.slice(0, -1); else if (key >= ' ') value += key; };
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on('data', onData);
  });
}
async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) { console.log('Usage: npm run setup:finance'); console.log('Creates one Finance account with a server-controlled branch association.'); return; }
  console.log('Create one real Finance account. Enter the intended existing branch ID; no branch is invented.');
  const fullName = await ask('Finance full name: ');
  const email = normalizeEmail(await ask('Finance email: '));
  const branchId = await ask('Branch ID: ');
  const password = await askHidden('Password (hidden, minimum 12 characters): ');
  if (!fullName || !email || !branchId || password.length < 12) throw new Error('Name, email, branch ID, and a password of at least 12 characters are required.');
  await connectDatabase(); const db = getDatabase();
  if (await db.collection('users').findOne({ emailLower: email })) throw new Error('A user with this email already exists; no records were created.');
  const userId = `USR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { passwordHash, passwordSalt } = hashPassword(password);
  await db.collection('users').insertOne({ id: userId, email, emailLower: email, fullName, role: 'finance', branchId, passwordHash, passwordSalt, active: true, createdAt: new Date() });
  const saved = await db.collection('users').findOne({ id: userId, role: 'finance', branchId, active: { $ne: false } });
  if (!saved) { await db.collection('users').deleteOne({ id: userId }); throw new Error('Finance branch association could not be verified; account rolled back.'); }
  const session = await login(email, password);
  if (!session?.user?.id || session.user.id !== userId || session.user.role !== 'finance' || session.user.branchId !== branchId) throw new Error('Finance account was created but branch-aware login verification failed.');
  await logout(session.token);
  const count = await db.collection('users').countDocuments({ id: userId, role: 'finance', branchId, active: { $ne: false } });
  console.log(`Created Finance account: ${email}`); console.log(`Finance User ID: ${userId}`); console.log(`Verified branch ID: ${branchId}`); console.log('Local login verification: passed; session revoked.'); console.log(`Verified documents in school_management: finance users=${count}`);
}
main().catch(async error => { console.error(error.message); await closeDatabase(); process.exitCode = 1; });
