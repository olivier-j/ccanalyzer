#!/usr/bin/env node

const { startServer } = require('../src/server');

const args = process.argv.slice(2);
const pIdx = args.indexOf('-p');
const userPort = pIdx !== -1 && args[pIdx + 1] ? parseInt(args[pIdx + 1], 10) : null;
const port = userPort || parseInt(process.env.PORT || '3737', 10);

const hIdx = args.indexOf('--host');
const userHost = hIdx !== -1 && args[hIdx + 1] ? args[hIdx + 1] : null;
const host = userHost || process.env.HOST || '127.0.0.1';

const sIdx = args.indexOf('--source');
const source = (sIdx !== -1 && args[sIdx + 1] ? args[sIdx + 1] : process.env.CCANALYZER_SOURCE) || 'claude';

startServer(port, host, source).then(({ url }) => {
  console.log(`\n  ccanalyzer running at ${url}  (source: ${source})\n`);
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
