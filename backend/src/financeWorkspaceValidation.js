const { Buffer } = require('node:buffer');

const chargeCategories = new Set([
  'tuition',
  'transport',
  'exam',
  'event',
  'books',
  'activity',
  'other',
]);
const expenseCategories = new Set([
  'utilities',
  'maintenance',
  'stationery',
  'events',
  'lab_supplies',
  'vendor_payments',
  'other',
]);
const paymentMethods = new Set([
  'cash',
  'bank_transfer',
  'card',
  'cheque',
  'other',
]);

function amount(value) {
  const number = Number(value);
  return Number.isFinite(number) &&
    number > 0 &&
    Math.round(number * 100) === number * 100
    ? number
    : null;
}
function text(value, max = 160) {
  return typeof value === 'string' && value.trim() && value.trim().length <= max
    ? value.trim()
    : null;
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
function validateImage(file) {
  if (
    !file ||
    !Buffer.isBuffer(file.buffer) ||
    file.size < 1 ||
    file.size > 5 * 1024 * 1024
  )
    return null;
  const bytes = file.buffer;
  const png =
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg =
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;
  if (png && file.mimetype === 'image/png')
    return { contentType: 'image/png', extension: 'png' };
  if (jpeg && file.mimetype === 'image/jpeg')
    return { contentType: 'image/jpeg', extension: 'jpg' };
  return null;
}

module.exports = {
  amount,
  text,
  validDate,
  validateImage,
  chargeCategories,
  expenseCategories,
  paymentMethods,
};
