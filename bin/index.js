#!/usr/bin/env node

const { startServer } = require('../src/server');

const port = parseInt(process.env.PORT || '3737', 10);

startServer(port).then(({ url }) => {
  console.log(`\n  ccanalyzer running at ${url}\n`);
  try {
    // Try to open browser
    import('open').then(m => m.default(url)).catch(() => {});
  } catch {}
}).catch(err => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
