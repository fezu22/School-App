const {createHash} = require('node:crypto');

// Process-local protection for the current single-process API. Multi-instance
// deployments must put equivalent limits in a shared store or trusted gateway.
function createLoginLimiter({now = () => Date.now(), windowMs = 15 * 60 * 1000, accountLimit = 10, ipLimit = 100, maxKeys = 10000} = {}) {
  const buckets = new Map();
  let requests = 0;
  function take(key, limit, time) {
    let bucket = buckets.get(key);
    if (bucket && bucket.until <= time) {buckets.delete(key); bucket = undefined;}
    if (!bucket) {
      if (buckets.size >= maxKeys) {
        for (const [stored, value] of buckets) if (value.until <= time) buckets.delete(stored);
        if (buckets.size >= maxKeys) return {allowed: false, until: time + windowMs};
      }
      bucket = {count: 0, until: time + windowMs};
      buckets.set(key, bucket);
    }
    if (bucket.count >= limit) return {allowed: false, until: bucket.until};
    bucket.count++;
    return {allowed: true, until: bucket.until, bucket};
  }
  return (req, res, next) => {
    const time = now();
    if (++requests % 128 === 0) for (const [key, value] of buckets) if (value.until <= time) buckets.delete(key);
    // Ignore caller-supplied forwarding headers. A trusted-proxy deployment
    // needs its own explicit, reviewed client-address configuration.
    const ip = String(req.socket?.remoteAddress || 'unknown');
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const ipAttempt = take('ip:' + ip, ipLimit, time);
    const accountKey = email && email.length <= 320 ? 'account:' + createHash('sha256').update(email).digest('hex') : null;
    const accountAttempt = ipAttempt.allowed && accountKey ? take(accountKey, accountLimit, time) : null;
    if (!ipAttempt.allowed || accountAttempt?.allowed === false) {
      const until = !ipAttempt.allowed ? ipAttempt.until : accountAttempt.until;
      res.set('Retry-After', String(Math.max(1, Math.ceil((until - time) / 1000))));
      return res.status(429).json({success: false, error: 'Too many sign-in attempts. Please retry later.'});
    }
    res.once('finish', () => {
      // Successful school logins should not exhaust a shared school NAT quota.
      if (res.statusCode >= 200 && res.statusCode < 300) {
        if (accountKey) buckets.delete(accountKey);
        if (ipAttempt.bucket) ipAttempt.bucket.count = Math.max(0, ipAttempt.bucket.count - 1);
      }
    });
    return next();
  };
}
module.exports = {createLoginLimiter};
