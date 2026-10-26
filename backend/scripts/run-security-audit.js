const {readFileSync, mkdirSync, writeFileSync} = require('node:fs');
const {resolve} = require('node:path');
const {spawnSync} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const root = resolve(__dirname, '..');
const matrix = JSON.parse(readFileSync(resolve(root, 'security-audit-100.json'), 'utf8'));
if (matrix.length !== 100 || new Set(matrix.map(row => row.title)).size !== 100) throw new Error('Audit must contain exactly 100 distinct test cases');
for (const row of matrix) {
  if (!/^(src\/[a-zA-Z]+\.node-test\.js|staff-tests\/[a-zA-Z-]+\.security\.test\.(ts|js))$/.test(row.file)) throw new Error('Unaudited test path');
  const text = readFileSync(resolve(root, row.file), 'utf8');
  if (/^\s*import\s+['"]dotenv\/config['"]/m.test(text)) throw new Error('Configured-database test forbidden');
}
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pattern = '^(?:' + matrix.map(row => escape(row.title)).join('|') + ')$';
const output = resolve(root, '../build/security-audit');
mkdirSync(output, {recursive: true});
const events = resolve(output, 'events.jsonl');
const env = {...process.env, MONGODB_URI: 'mongodb://127.0.0.1:1/DO_NOT_USE', MONGODB_DB: 'DO_NOT_USE', DOTENV_CONFIG_PATH: resolve(root, '.disabled-test-env'), ONLINE_PAYMENTS_VERIFIED: 'false', LIVE_LESSONS_VERIFIED: 'false', LIVE_LESSON_ENABLED: 'false'};
delete env.INTEGRATED_STAFF_ENABLED;
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', '--test-reporter=' + pathToFileURL(resolve(__dirname, 'security-audit-reporter.js')).href, '--test-reporter-destination=' + events, '--test-name-pattern=' + pattern, ...new Set(matrix.map(row => resolve(root, row.file)))], {cwd: root, env, stdio: 'inherit'});
const records = readFileSync(events, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
const results = matrix.map(row => {
  const matches = records.filter(event => ['test:pass', 'test:fail'].includes(event.type) && event.name === row.title && !event.skip);
  return {...row, status: matches.length === 1 ? (matches[0].type === 'test:pass' ? 'PASS' : 'FAIL') : 'NOT_VERIFIED', durationMs: matches[0]?.details?.duration_ms, error: matches[0]?.details?.error?.message};
});
const summary = {total: 100, pass: results.filter(row => row.status === 'PASS').length, fail: results.filter(row => row.status === 'FAIL').length, notVerified: results.filter(row => row.status === 'NOT_VERIFIED').length, processExitCode: result.status, cases: results};
writeFileSync(resolve(output, 'results.json'), JSON.stringify(summary, null, 2));
writeFileSync(resolve(output, 'results.csv'), 'ID,Category,Status,Scenario,Test file\n' + results.map(row => [row.id, row.category, row.status, row.scenario, row.file].map(value => '"' + value.replaceAll('"', '""') + '"').join(',')).join('\n') + '\n');
console.log(JSON.stringify({total: summary.total, pass: summary.pass, fail: summary.fail, notVerified: summary.notVerified, processExitCode: result.status}));
process.exitCode = result.status === 0 && summary.pass === 100 ? 0 : 1;
