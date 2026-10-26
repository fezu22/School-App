const { readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const sourceDirectory = resolve(__dirname, '..', 'src');
const testFiles = readdirSync(sourceDirectory)
  .filter(name => name.endsWith('.node-test.js'))
  .sort()
  .map(name => resolve(sourceDirectory, name));

if (!testFiles.length) {
  console.error('No backend *.node-test.js files were found.');
  process.exitCode = 1;
} else {
  const result = spawnSync(process.execPath, ['--test', ...testFiles], {
    cwd: resolve(__dirname, '..'),
    stdio: 'inherit',
  });
  process.exitCode = result.status ?? 1;
}
