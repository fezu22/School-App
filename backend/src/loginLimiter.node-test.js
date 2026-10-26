const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {createLoginLimiter} = require('./loginLimiter');
function attempt(limiter, email, ip = '127.0.0.1') {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.set = (key, value) => {res[key] = value; return res;};
  res.status = value => {res.statusCode = value; return res;};
  res.json = () => res;
  let passed = false;
  limiter({body: {email}, socket: {remoteAddress: ip}}, res, () => {passed = true;});
  return {res, passed};
}
test('login throttling expires without permanently locking a real account', () => {
  let now = 0;
  const limiter = createLoginLimiter({now: () => now, windowMs: 1000, accountLimit: 1});
  assert.equal(attempt(limiter, 'user@test.invalid').passed, true);
  assert.equal(attempt(limiter, 'USER@test.invalid').res.statusCode, 429);
  now = 1000;
  assert.equal(attempt(limiter, 'user@test.invalid').passed, true);
});
test('successful sign-in refunds the shared school NAT quota and account limit', () => {
  const limiter = createLoginLimiter({accountLimit: 1, ipLimit: 1});
  const first = attempt(limiter, 'user@test.invalid');
  first.res.emit('finish');
  assert.equal(attempt(limiter, 'another@test.invalid').passed, true);
});
test('limiter saturation fails closed instead of evicting active protections', () => {
  const limiter = createLoginLimiter({maxKeys: 2, accountLimit: 1});
  assert.equal(attempt(limiter, 'first@test.invalid').passed, true);
  assert.equal(attempt(limiter, 'rotated@test.invalid').res.statusCode, 429);
  assert.equal(attempt(limiter, 'first@test.invalid').res.statusCode, 429);
});
