const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const apiRoutes = require('./routes');
const { attachChatRealtime } = require('./chatRealtime');
const { startParentPaymentReconciler } = require('./parentPaymentReconciler');
const { connectDatabase, closeDatabase, getDatabase } = require('./database');
const { isStaffPath, loadStaffApplication } = require('./staffIntegration');

let staffApplication;
function createApplication({staff = () => staffApplication} = {}) {
const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', async (_req, res) => {
  try {
    await getDatabase().command({ ping: 1 });
    return res.status(200).json({
      success: true,
      status: 'ok',
      database: 'connected',
    });
  } catch {
    console.error('Health check failed');
    return res.status(503).json({
      success: false,
      status: 'unavailable',
      database: 'disconnected',
    });
  }
});

app.get('/', (_req, res) =>
  res.json({
    success: true,
    message: 'School Management System API is running',
  }),
);
// Explicit routing avoids the two applications shadowing each other's APIs.
app.use((req, res, next) => {
  if (process.env.INTEGRATED_STAFF_ENABLED !== 'true') return next();
  if (req.path === '/api/live-lessons' || req.path.startsWith('/api/live-lessons/')) {
    return res.status(503).json({ success: false, error: 'Integrated live lessons require the shared session-fencing contract.' });
  }
  if (req.path === '/api/sessions' || req.path.startsWith('/api/sessions/')) {
    return res.status(503).json({success: false, error: 'Administrator session management requires the shared-session tenant and revocation contract.'});
  }
  if (!isStaffPath(req.originalUrl)) return next();
  const staffApp = staff();
  if (!staffApp) return res.status(503).json({ success: false, error: 'Staff APIs are not ready.' });
  return staffApp(req, res, next);
});
app.use('/api', apiRoutes);
app.use((error, _req, res, _next) => {
  if (error.type === 'entity.parse.failed') return res.status(400).json({success: false, error: 'Invalid JSON request.'});
  if (error.type === 'entity.too.large') return res.status(413).json({success: false, error: 'Request body is too large.'});
  // Parser/driver messages can contain submitted credentials or connection
  // details. Keep untrusted error text out of logs and public responses.
  console.error('Request failed: internal server error');
  const reportableIntegrationError =
    typeof error.code === 'string' &&
    (error.code.startsWith('INTEGRATION_REFERENCE_') ||
      error.code === 'INTEGRATION_SCHOOL_SCOPE_REQUIRED' ||
      error.code === 'ROLE_ACCESS_DENIED' ||
      error.code === 'BRANCH_ACCESS_DENIED');
  res.status(reportableIntegrationError ? error.statusCode || 503 : 500).json({
    success: false,
    error: reportableIntegrationError ? error.message : 'Unexpected server error',
    ...(reportableIntegrationError ? { code: error.code } : {}),
  });
});

return app;
}
const app = createApplication();

async function startServer() {
  const port = Number(process.env.PORT) || 5000;
  await connectDatabase();
  if (process.env.INTEGRATED_STAFF_ENABLED === 'true') staffApplication = await loadStaffApplication();
  await apiRoutes.initializeFinanceIndexes();
  await apiRoutes.initializeChatIndexes();
  const parentPaymentReconciler = startParentPaymentReconciler();
  const server = app.listen(port, () =>
    console.log(
      `JavaScript API server listening on port ${port}; MongoDB connected`,
    ),
  );
  const chatRealtime = attachChatRealtime(server);
  apiRoutes.setChatRealtimePublisher(chatRealtime.publish);

  const shutdown = signal => {
    console.log(`${signal} received; shutting down`);
    parentPaymentReconciler.stop();
    server.close(async error => {
      try {
        await closeDatabase();
        if (staffApplication) await require('mongoose').disconnect();
      } finally {
        process.exit(error ? 1 : 0);
      }
    });
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  return server;
}

if (require.main === module) {
  startServer().catch(() => {
    console.error('API startup failed. Verify private database configuration.');
    process.exitCode = 1;
  });
}

module.exports = { app, startServer, createApplication };
