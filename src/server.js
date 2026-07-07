const express = require('express');
const path = require('path');

// Pick the data source: Claude Code (default) or OpenCode. Both modules expose
// the same function contract, so the routes below stay source-agnostic.
function loadSource(source) {
  const name = (source || process.env.CCANALYZER_SOURCE || 'claude').toLowerCase();
  if (name === 'opencode') return require('./sources/opencode');
  return require('./parser');
}

function startServer(port = 3737, host = '127.0.0.1', source = null) {
  const { getAllProjects, getSessionDetail, getSessionInsights, getSessionMessagesPage, getAgentDetail, getStatsCache, getToolUsage } = loadSource(source);
  const app = express();
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/projects', (req, res) => {
    try { res.json(getAllProjects()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/projects/:dirName/sessions/:sessionFile', (req, res) => {
    try {
      res.json(getSessionDetail(
        decodeURIComponent(req.params.dirName),
        decodeURIComponent(req.params.sessionFile)
      ));
    } catch (e) { res.status(404).json({ error: e.message }); }
  });

  app.get('/api/projects/:dirName/sessions/:sessionFile/insights', (req, res) => {
    try {
      res.json(getSessionInsights(
        decodeURIComponent(req.params.dirName),
        decodeURIComponent(req.params.sessionFile)
      ));
    } catch (e) { res.status(404).json({ error: e.message }); }
  });

  app.get('/api/projects/:dirName/sessions/:sessionFile/messages', (req, res) => {
    try {
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
      const limit = Math.max(1, parseInt(req.query.limit, 10) || 150);
      res.json(getSessionMessagesPage(
        decodeURIComponent(req.params.dirName),
        decodeURIComponent(req.params.sessionFile),
        offset,
        limit
      ));
    } catch (e) { res.status(404).json({ error: e.message }); }
  });

  app.get('/api/projects/:dirName/sessions/:sessionFile/agents/:agentId', (req, res) => {
    try {
      res.json(getAgentDetail(
        decodeURIComponent(req.params.dirName),
        decodeURIComponent(req.params.sessionFile),
        decodeURIComponent(req.params.agentId)
      ));
    } catch (e) { res.status(404).json({ error: e.message }); }
  });

  app.get('/api/stats', (req, res) => {
    try { res.json(getStatsCache() || {}); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/tool-usage', (req, res) => {
    try { res.json(getToolUsage()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      resolve({ url: `http://localhost:${port}`, server });
    });
    server.on('error', reject);
  });
}

module.exports = { startServer };
