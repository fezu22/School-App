const {readdirSync, readFileSync} = require('node:fs');
const {resolve} = require('node:path');
const {spawnSync} = require('node:child_process');
const root = resolve(__dirname, '..');
const directory = resolve(root, 'staff-tests');
// The historical auth.test.ts and userModel.test.ts explicitly use dotenv and
// write to the configured database. They must never run in this safety suite.
const files = readdirSync(directory).filter(name => name.endsWith('.security.test.ts') || name === 'zego-room-control.test.ts');
for (const name of files) {
  const text = readFileSync(resolve(directory, name), 'utf8');
  if (/^\s*import\s+['"]dotenv\/config['"]/m.test(text)) throw new Error('Unsafe configured-database test: ' + name);
}
const env = {...process.env, MONGODB_URI: 'mongodb://127.0.0.1:1/DO_NOT_USE', MONGODB_DB: 'DO_NOT_USE', DOTENV_CONFIG_PATH: resolve(root, '.disabled-test-env')};
delete env.INTEGRATED_STAFF_ENABLED;
delete env.ONLINE_PAYMENTS_VERIFIED;
const selected = process.argv.slice(2);
if (selected.some(name => !files.includes(name))) throw new Error('Only audited isolated staff tests may be selected');
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', ...(selected.length ? selected : files.sort()).map(name => resolve(directory, name))], {cwd: root, env, stdio: 'inherit'});
process.exitCode = result.status ?? 1;
