const express = require('express');
const path = require('path');
const { getAllProjects, getSessionDetail, getAgentDetail, getStatsCache } = require('./parser');

function startServer(port = 3737) {
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

  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => {
      resolve({ url: `http://localhost:${port}`, server });
    });
    server.on('error', reject);
  });
}

module.exports = { startServer };
