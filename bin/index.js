#!/usr/bin/env node

const { startServer } = require('../src/server');

const args = process.argv.slice(2);
const pIdx = args.indexOf('-p');
const userPort = pIdx !== -1 && args[pIdx + 1] ? parseInt(args[pIdx + 1], 10) : null;
const port = userPort || parseInt(process.env.PORT || '3737', 10);

startServer(port).then(({ url }) => {
  console.log(`\n  ccanalyzer running at ${url}\n`);
  try {
    import('open').then(m => m.default(url)).catch(() => {});
  } catch {}
}).catch(err => {
  if (err.code === 'EADDRINUSE' && !userPort) {
    console.error(`\n  Port ${port} is already in use.`);
    console.error(`  Try a different port:\n`);
    console.error(`    npx ccanalyzer -p ${port + 1}\n`);
  } else {
    console.error('Failed to start server:', err.message);
  }
  process.exit(1);
});
