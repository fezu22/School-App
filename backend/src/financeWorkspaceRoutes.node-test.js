const test = require('node:test');
const assert = require('node:assert/strict');
const __test = require('./financeWorkspaceValidation');

test('workspace amount validation accepts positive cents only', () => {
  assert.equal(__test.amount('120.50'), 120.5);
  assert.equal(__test.amount('0.01'), 0.01);
  assert.equal(__test.amount('0'), null);
  assert.equal(__test.amount('-2'), null);
  assert.equal(__test.amount('1.001'), null);
  assert.equal(__test.amount('NaN'), null);
  assert.equal(__test.chargeCategories.has('tuition'), true);
  assert.equal(__test.chargeCategories.has('gateway'), false);
});

test('workspace text and date validation reject empty and malformed values', () => {
  assert.equal(__test.text('  Stationery  '), 'Stationery');
  assert.equal(__test.text(' '), null);
  assert.equal(__test.text('x'.repeat(161), 160), null);
  assert.equal(__test.validDate('2026-10-18'), true);
  assert.equal(__test.validDate('2026-02-30'), false);
  assert.equal(__test.validDate('18-10-2026'), false);
});

test('expense attachments require matching safe file signatures and MIME types', () => {
  const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  assert.equal(
    __test.validateImage({
      buffer: pngBytes,
      size: pngBytes.length,
      mimetype: 'image/png',
    }).contentType,
    'image/png',
  );
  assert.equal(
    __test.validateImage({
      buffer: Buffer.from('%PDF-1.7'),
      size: 8,
      mimetype: 'application/pdf',
    }),
    null,
  );
  assert.equal(
    __test.validateImage({
      buffer: pngBytes,
      size: pngBytes.length,
      mimetype: 'image/jpeg',
    }),
    null,
  );
  assert.equal(
    __test.validateImage({
      buffer: pngBytes,
      size: 5 * 1024 * 1024 + 1,
      mimetype: 'image/png',
    }),
    null,
  );
});
