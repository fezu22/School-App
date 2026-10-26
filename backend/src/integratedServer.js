process.env.INTEGRATED_STAFF_ENABLED = 'true';
const { startServer } = require('./server');
startServer().catch(() => {
  console.error('Integrated API startup failed. Verify database configuration and staff dependencies.');
  process.exitCode = 1;
});
