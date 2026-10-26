const {readdirSync, readFileSync} = require('node:fs');
const {join, relative, resolve} = require('node:path');
const root = resolve(__dirname, '..');
const rows = [];
function walk(directory) {
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.(js|ts)$/.test(entry.name) && !entry.name.includes('node-test')) {
      const lines = readFileSync(path, 'utf8').split(/\r?\n/);
      const operations = [];
      lines.forEach((line, index) => {
        if (/\.collection\(|\.find\(|\.findOne\(|\.findById\(|\.aggregate\(|\.countDocuments\(|\.bulkWrite\(|\.insert|\.update|\.delete|\.save\(/.test(line)) operations.push(index + 1);
      });
      if (operations.length) rows.push({file: relative(root, path).replaceAll('\\', '/'), lines: operations});
    }
  }
}
walk(join(root, 'src'));
console.log(JSON.stringify({
  status: 'incomplete',
  limitation: 'Static operation inventory, not a security proof. Review indirect model calls, raw operations, realtime, files, jobs and exports too.',
  adopted: ['Integrated Super Admin dashboard via verifiedSchoolDatabase', 'Exam-paper module uses its existing independent school checks'],
  files: rows,
}, null, 2));
