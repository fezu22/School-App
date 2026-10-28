const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../src/mobileApp');
const extensions = ['', '.js', '.jsx', '.ts', '.tsx', '.json', '.png', '.webp'];
const unresolved = [];

function resolves(target) {
  return (
    extensions.some(extension => fs.existsSync(target + extension)) ||
    fs.existsSync(path.join(target, 'index.js')) ||
    fs.existsSync(path.join(target, 'index.jsx')) ||
    fs.existsSync(path.join(target, 'index.ts')) ||
    fs.existsSync(path.join(target, 'index.tsx'))
  );
}

function inspect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      inspect(filename);
      continue;
    }
    if (!/\.(js|jsx)$/.test(filename)) continue;

    const source = fs.readFileSync(filename, 'utf8');
    const references = source.matchAll(
      /(?:from\s+|require\()['"](\.[^'"]+)['"]/g,
    );
    for (const reference of references) {
      const target = path.resolve(path.dirname(filename), reference[1]);
      if (!resolves(target)) {
        unresolved.push(
          `${path.relative(root, filename)}: ${reference[1]}`,
        );
      }
    }
  }
}

inspect(root);
if (unresolved.length) {
  console.error(unresolved.join('\n'));
  process.exitCode = 1;
} else {
  console.log('All relative mobile imports and assets resolve.');
}
