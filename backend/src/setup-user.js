const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { connectDatabase, closeDatabase, getDatabase } = require('./database');
const { hashPassword, normalizeEmail } = require('./auth');
const readline = require('node:readline');
function arg(name) { const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : ''; }
function usage() { console.log('Usage: node src/setup-user.js --email <email> --full-name "<name>" --role parent|student|finance [--branch-id <branch>]'); console.log('If --password is omitted, it is requested with terminal echo disabled.'); }
function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) return reject(new Error('A TTY is required for the hidden password prompt.')); 
    const input = readline.createInterface({ input: process.stdin, output: process.stdout });
    process.stdout.write(prompt);
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true); process.stdin.resume(); let value = '';
    const onData = chunk => { const key = chunk.toString('utf8'); if (key === '\\u0003') { cleanup(); reject(new Error('Password entry cancelled.')); } else if (key === '\\r' || key === '\\n') { cleanup(); process.stdout.write('\\n'); resolve(value); } else if (key === '\\u007f') { value = value.slice(0, -1); } else if (key >= ' ') value += key; };
    const cleanup = () => { process.stdin.off('data', onData); process.stdin.setRawMode(wasRaw || false); input.close(); };
    process.stdin.on('data', onData);
  });
}
async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) { usage(); return; }
  const email = normalizeEmail(arg('email')); const fullName = arg('full-name').trim(); const role = arg('role').trim().toLowerCase(); const branchId = arg('branch-id').trim(); let password = arg('password');
  if (!password) password = await readHidden('Password (hidden): ');
  if (!email || !password || !fullName || !['parent', 'student', 'finance'].includes(role)) throw new Error('Usage: node src/setup-user.js --email <email> --password <password> --full-name "<name>" --role parent|student|finance [--branch-id <branch>]');
  if (password.length < 12) throw new Error('Password must be at least 12 characters.'); if (role === 'finance' && !branchId) throw new Error('Finance accounts require --branch-id.');
  await connectDatabase(); const db = getDatabase(); if (await db.collection('users').findOne({ emailLower: email })) throw new Error('A user with this email already exists.');
  const { passwordHash, passwordSalt } = hashPassword(password); const id = `USR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.collection('users').insertOne({ id, email, emailLower: email, fullName, role, ...(branchId ? { branchId } : {}), passwordHash, passwordSalt, active: true, createdAt: new Date() });
  console.log(`Created ${role} account ${email}. User ID: ${id}. Link it to a real ${role === 'parent' ? 'parent/child record' : role === 'student' ? 'student record' : 'finance branch'} before protected data access.`); await closeDatabase();
}
main().catch(async error => { console.error(error.message); await closeDatabase(); process.exitCode = 1; });
