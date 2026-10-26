const express = require('express');
const { login, logout, authenticateRequest } = require('./auth');
const router = express.Router();
const loginLimiter = require('./loginLimiter').createLoginLimiter();

router.get('/me', authenticateRequest, (req, res) => {
  res.json({ success: true, data: req.user });
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const result = await login(req.body?.email, req.body?.password);
    if (!result) return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    return res.json({ success: true, data: result });
  } catch (error) { return next(error); }
});

router.post('/logout', async (req, res, next) => {
  try {
    const header = typeof req.get('Authorization') === 'string' ? req.get('Authorization') : '';
    const match = /^Bearer\s+([A-Za-z0-9_-]{32,})$/.exec(header);
    await logout(match?.[1]);
    return res.json({ success: true });
  } catch (error) { return next(error); }
});

module.exports = router;
