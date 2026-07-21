// OpenCode source adapter for ccanalyzer.
//
// Reads OpenCode's local SQLite store (`opencode.db`) and normalises it into the
// exact same shapes the Claude Code parser (`src/parser.js`) produces, so the
// Express API (`src/server.js`) and the vanilla-JS frontend work unchanged.
//
// OpenCode storage model (current, >= ~v1.16, SQLite):
//   project(id, worktree, vcs, ...)
//   session(id, project_id, parent_id, title, directory, model, agent,
//           cost, tokens_input, tokens_output, tokens_reasoning,
//           tokens_cache_read, tokens_cache_write, time_created, time_updated)
//   message(id, session_id, time_created, data)   -- data = JSON blob
//   part(id, message_id, session_id, data)        -- data = JSON blob
//
// A subagent is a *child session* (parent_id set); it is spawned by a `task`
// tool part whose `state.metadata.sessionId` points at the child. Cost/tokens
// are pre-computed by OpenCode (multi-provider), so we use them directly instead
// of the Anthropic price table.

const fs = require('fs');
const path = require('path');
const os = require('os');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {
  DatabaseSync = null;
}

function dataDir() {
  if (process.env.OPENCODE_DATA_DIR) return process.env.OPENCODE_DATA_DIR;
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) return path.join(xdg, 'opencode');
  return path.join(os.homedir(), '.local', 'share', 'opencode');
}

function dbPath() {
  return path.join(dataDir(), 'opencode.db');
}

// ── Lazy, read-only, single connection (server is long-lived) ──
let _db = null;
function db() {
  if (_db) return _db;
  if (!DatabaseSync) {
    throw new Error(
      'OpenCode source requires the built-in node:sqlite module (Node >= 22). ' +
      'Please run ccanalyzer on Node 22 or newer.'
    );
  }
  const p = dbPath();
  if (!fs.existsSync(p)) {
    throw new Error(`OpenCode database not found at ${p}. Set OPENCODE_DATA_DIR to override.`);
  }
  _db = new DatabaseSync(p, { readOnly: true });
  return _db;
}

// ── helpers ──
const MS = (n) => (n ? new Date(n).toISOString() : null);

function parseJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

// OpenCode stores reasoning tokens separately; the `output` bucket excludes them
// (verified against real data: output=38, reasoning=598). Fold reasoning into the
// output figure so token totals reflect what was actually generated.
function usageFromSessionRow(s) {
  return {
    input: s.tokens_input || 0,
    output: (s.tokens_output || 0) + (s.tokens_reasoning || 0),
    cache_write: s.tokens_cache_write || 0,
    cache_read: s.tokens_cache_read || 0,
  };
}

function addUsage(dst, src) {
  dst.input += src.input;
  dst.output += src.output;
  dst.cache_write += src.cache_write;
  dst.cache_read += src.cache_read;
}

function newUsage() { return { input: 0, output: 0, cache_write: 0, cache_read: 0 }; }

function modelLabel(raw) {
  // session.model is a JSON string {id, providerID, variant}; messages use
  // {providerID, modelID}. Normalise to "provider/model".
  if (!raw) return null;
  const m = typeof raw === 'string' ? parseJson(raw) : raw;
  if (!m) return typeof raw === 'string' ? raw : null;
  const model = m.modelID || m.id || m.model;
  if (!model) return null;
  return m.providerID ? `${m.providerID}/${model}` : model;
}

// Full message bodies are streamed to the client in pages of this size.
const MESSAGE_PAGE_SIZE = 150;

const BUILTIN_TOOLS = new Set([
  'bash', 'read', 'write', 'edit', 'multiedit', 'patch', 'grep', 'glob', 'ls',
  'list', 'todowrite', 'todoread', 'task', 'question', 'webfetch', 'websearch',
  'invalid', 'skill', 'lsp',
]);

// Classify an OpenCode tool name into ccanalyzer's buckets.
function classifyTool(name) {
  if (!name) return { kind: 'builtin', name: '(unknown)' };
  if (name === 'task') return { kind: 'agent' };
  if (name === 'skill') return { kind: 'skill' };
  if (!BUILTIN_TOOLS.has(name) && name.includes('_')) {
    // MCP tools are exposed as "<server>_<tool>".
    return { kind: 'mcp', server: name.split('_')[0], full: name };
  }
  return { kind: 'builtin', name };
}

// ── low-level session loaders ──

function allSessions() {
  return db().prepare(
    `SELECT id, project_id, parent_id, slug, title, directory, model, agent,
            cost, tokens_input, tokens_output, tokens_reasoning,
            tokens_cache_read, tokens_cache_write, time_created, time_updated
     FROM session`
  ).all();
}

function messageCountsBySession() {
  const rows = db().prepare(
    `SELECT session_id, count(*) c FROM message GROUP BY session_id`
  ).all();
  const map = new Map();
  for (const r of rows) map.set(r.session_id, r.c);
  return map;
}

// Number of lines in a string (newline count + 1), 0 for empty/non-string.
function lineCount(t) {
  if (typeof t !== 'string' || t.length === 0) return 0;
  let n = 1;
  for (let i = 0; i < t.length; i++) if (t.charCodeAt(i) === 10) n++;
  return n;
}

// Lines authored via file-writing tools, summed per session — parity with the
// Claude parser's linesGenerated. OpenCode tool names are lower-case and edits
// use camelCase newString (older rows may use new_string). Best-effort: unknown
// shapes contribute 0 rather than throwing.
function linesBySession() {
  const map = new Map();
  let rows;
  try {
    rows = db().prepare(
      `SELECT session_id AS sid,
              lower(json_extract(data,'$.tool')) AS tool,
              json_extract(data,'$.state.input.content') AS content,
              json_extract(data,'$.state.input.newString') AS newString,
              json_extract(data,'$.state.input.new_string') AS new_string,
              json_extract(data,'$.state.input.edits') AS edits
       FROM part WHERE json_extract(data,'$.type') = 'tool'`
    ).all();
  } catch { return map; }
  for (const r of rows) {
    let n = 0;
    if (r.tool === 'write') n = lineCount(r.content);
    else if (r.tool === 'edit') n = lineCount(r.newString || r.new_string);
    else if (r.tool === 'multiedit') {
      try {
        const edits = r.edits ? JSON.parse(r.edits) : [];
        if (Array.isArray(edits)) n = edits.reduce((s, e) => s + lineCount(e && (e.newString || e.new_string)), 0);
      } catch { /* leave n = 0 */ }
    }
    if (n) map.set(r.sid, (map.get(r.sid) || 0) + n);
  }
  return map;
}

// Build the normalised message list (with reconstructed content[]) for a session.
// Reconstruct one message's content[] from its parts.
function partsToContent(parts) {
  const content = [];
  for (const p of parts) {
    switch (p.type) {
      case 'text':
        if (p.text) content.push({ type: 'text', text: p.text });
        break;
      case 'reasoning':
        if (p.text) content.push({ type: 'thinking', thinking: p.text });
        break;
      case 'tool':
        content.push({
          type: 'tool_use',
          id: p.callID,
          name: p.tool,
          input: (p.state && p.state.input) || {},
        });
        break;
      default:
        break; // step-start / step-finish / patch / file / subtask / compaction
    }
  }
  return content;
}

// Turn message rows + a parts-by-message map into normalised message objects
// (matching the Claude parser shape).
function assembleMessages(msgRows, partsByMsg) {
  const messages = [];
  for (const row of msgRows) {
    const data = parseJson(row.data);
    if (!data) continue;
    const role = data.role;
    if (role !== 'user' && role !== 'assistant') continue;

    const content = partsToContent(partsByMsg.get(row.id) || []);
    messages.push({
      uuid: row.id,
      parentUuid: data.parentID || null,
      type: role,
      timestamp: MS(row.time_created || data.time?.created),
      isSidechain: false,
      content: role === 'user' ? (content.length ? content : '') : content,
      usage: role === 'assistant' ? {
        input_tokens: data.tokens?.input || 0,
        output_tokens: (data.tokens?.output || 0) + (data.tokens?.reasoning || 0),
        cache_creation_input_tokens: data.tokens?.cache?.write || 0,
        cache_read_input_tokens: data.tokens?.cache?.read || 0,
      } : null,
      model: role === 'assistant' ? modelLabel({ providerID: data.providerID, modelID: data.modelID }) : null,
      stopReason: data.finish || null,
    });
  }
  return messages;
}

// Load parts for a specific set of message ids (chunked IN-list to stay within
// SQLite's bind-variable limit). Only these messages' blobs are read — the key
// to cheap pagination on huge sessions.
function loadPartsByMessage(messageIds) {
  const partsByMsg = new Map();
  const CH = 400;
  for (let i = 0; i < messageIds.length; i += CH) {
    const slice = messageIds.slice(i, i + CH);
    if (!slice.length) break;
    const ph = slice.map(() => '?').join(',');
    const rows = db().prepare(
      `SELECT message_id, data FROM part WHERE message_id IN (${ph}) ORDER BY id`
    ).all(...slice);
    for (const r of rows) {
      const d = parseJson(r.data);
      if (!d) continue;
      if (!partsByMsg.has(r.message_id)) partsByMsg.set(r.message_id, []);
      partsByMsg.get(r.message_id).push(d);
    }
  }
  return partsByMsg;
}

// One ordered page of full messages. Returns nextOffset/done so the caller can
// keep paging without a separate count(*).
function getMessagePage(sessionId, offset, limit) {
  const msgRows = db().prepare(
    `SELECT id, time_created, data FROM message
     WHERE session_id = ? ORDER BY time_created, id LIMIT ? OFFSET ?`
  ).all(sessionId, limit, offset);
  const partsByMsg = loadPartsByMessage(msgRows.map(r => r.id));
  return {
    messages: assembleMessages(msgRows, partsByMsg),
    nextOffset: offset + msgRows.length,
    done: msgRows.length < limit,
  };
}

// Full message list for a session (used for small child/agent sessions).
function buildAllMessages(sessionId) {
  const msgRows = db().prepare(
    `SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created, id`
  ).all(sessionId);
  const partsByMsg = loadPartsByMessage(msgRows.map(r => r.id));
  return assembleMessages(msgRows, partsByMsg);
}

// Build the compact per-message timeline (for the Gantt), the aggregated
// conversation tool-usage bucket, session-wide MCP/skill sets, and the task→
// child spawn links — all from a single scan over the session's parts plus a
// lightweight column-only read of the messages.
function buildTimelineAndTools(sessionId) {
  const mrows = db().prepare(
    `SELECT id, time_created,
            json_extract(data,'$.role') role,
            json_extract(data,'$.tokens.input') ti,
            json_extract(data,'$.tokens.output') tout,
            json_extract(data,'$.tokens.reasoning') tr,
            json_extract(data,'$.providerID') pid,
            json_extract(data,'$.modelID') mid,
            json_extract(data,'$.finish') finish
     FROM message WHERE session_id = ? ORDER BY time_created, id`
  ).all(sessionId);

  const prows = db().prepare(
    `SELECT message_id AS mid,
            json_extract(data,'$.type') AS type,
            json_extract(data,'$.tool') AS tool,
            json_extract(data,'$.state.input.name') AS skillName,
            CASE WHEN json_extract(data,'$.tool') = 'task' THEN data ELSE NULL END AS taskdata
     FROM part WHERE session_id = ?`
  ).all(sessionId);

  const toolsByMsg = new Map();
  const conv = { tools: {}, skills: {}, mcpServers: {}, mcpTools: {}, agents: {}, totalCalls: 0 };
  const mcps = new Set();
  const skills = new Set();
  const taskByChild = new Map();
  const toolUseMap = {};

  for (const r of prows) {
    if (r.type !== 'tool') continue;
    if (!toolsByMsg.has(r.mid)) toolsByMsg.set(r.mid, []);
    toolsByMsg.get(r.mid).push(r.tool);
    conv.totalCalls++;
    const c = classifyTool(r.tool);
    if (c.kind === 'mcp') {
      conv.mcpServers[c.server] = (conv.mcpServers[c.server] || 0) + 1;
      conv.mcpTools[c.full] = (conv.mcpTools[c.full] || 0) + 1;
      mcps.add(c.server);
    } else if (c.kind === 'skill') {
      // OpenCode invokes a skill via the `skill` tool with the skill name in
      // state.input.name (e.g. "customize-opencode").
      const sk = r.skillName || '(skill)';
      conv.skills[sk] = (conv.skills[sk] || 0) + 1;
      skills.add(sk);
    } else if (c.kind !== 'agent') {
      conv.tools[c.name] = (conv.tools[c.name] || 0) + 1;
    }
    if (r.taskdata) {
      const d = parseJson(r.taskdata);
      const childId = d?.state?.metadata?.sessionId;
      const ts = MS(d?.state?.time?.start);
      if (d?.callID) toolUseMap[d.callID] = { timestamp: ts, uuid: r.mid };
      if (childId) taskByChild.set(childId, { messageId: r.mid, callID: d?.callID || null, ts });
    }
  }

  const trows = db().prepare(
    `SELECT message_id AS mid, substr(json_extract(data,'$.text'), 1, 160) AS t
     FROM part WHERE session_id = ? AND json_extract(data,'$.type') = 'text'`
  ).all(sessionId);
  const prevByMsg = new Map();
  for (const r of trows) { if (r.t && !prevByMsg.has(r.mid)) prevByMsg.set(r.mid, r.t); }

  const timeline = [];
  for (const m of mrows) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    timeline.push({
      uuid: m.id,
      type: m.role,
      timestamp: MS(m.time_created),
      isSidechain: false,
      usage: m.role === 'assistant'
        ? { input_tokens: m.ti || 0, output_tokens: (m.tout || 0) + (m.tr || 0) }
        : null,
      tools: toolsByMsg.get(m.id) || [],
      preview: prevByMsg.get(m.id) || null,
      model: m.role === 'assistant' ? modelLabel({ providerID: m.pid, modelID: m.mid }) : null,
      stopReason: m.finish || null,
    });
  }

  return { timeline, convTools: conv, mcps: [...mcps], skills: [...skills], toolUseMap, taskByChild };
}

// ── public API (mirrors src/parser.js) ──

function getAllProjects() {
  if (!DatabaseSync || !fs.existsSync(dbPath())) return [];

  const projectRows = db().prepare(
    `SELECT id, worktree, vcs, time_created, time_updated FROM project`
  ).all();
  const projectById = new Map(projectRows.map(p => [p.id, p]));

  const sessions = allSessions();
  const counts = messageCountsBySession();
  const lines = linesBySession();

  // Group child sessions (subagents) under their parent.
  const childrenByParent = new Map();
  for (const s of sessions) {
    if (s.parent_id) {
      if (!childrenByParent.has(s.parent_id)) childrenByParent.set(s.parent_id, []);
      childrenByParent.get(s.parent_id).push(s);
    }
  }

  const byProject = new Map();

  for (const s of sessions) {
    if (s.parent_id) continue; // main sessions become session cards

    const proj = projectById.get(s.project_id);
    const worktree = proj?.worktree || s.directory || '/';
    const name = worktree.split('/').filter(Boolean).pop() || worktree;

    if (!byProject.has(s.project_id)) {
      byProject.set(s.project_id, {
        dirName: s.project_id,
        name,
        path: worktree,
        sessionCount: 0,
        totalMessages: 0,
        linesGenerated: 0,
        totalCost: 0,
        totalUsage: newUsage(),
        firstActivity: null,
        lastActivity: null,
        sessions: [],
      });
    }
    const P = byProject.get(s.project_id);

    // Session card totals = own + subagents (so the project total == Σ cards and
    // reflects true spend, since OpenCode session.cost excludes children).
    const ownUsage = usageFromSessionRow(s);
    const cardUsage = newUsage();
    addUsage(cardUsage, ownUsage);
    let cardCost = s.cost || 0;
    const ownCount = counts.get(s.id) || 0;
    let subCount = 0;
    let cardLines = lines.get(s.id) || 0;
    const kids = childrenByParent.get(s.id) || [];
    for (const k of kids) {
      addUsage(cardUsage, usageFromSessionRow(k));
      cardCost += k.cost || 0;
      subCount += counts.get(k.id) || 0;
      cardLines += lines.get(k.id) || 0;
    }

    const firstTs = MS(s.time_created);
    const lastTs = MS(s.time_updated || s.time_created);

    P.sessions.push({
      projectDirName: s.project_id,
      sessionId: s.id,
      file: s.id,
      title: s.title || 'Untitled session',
      cwd: s.directory || worktree,
      gitBranch: null,
      model: modelLabel(s.model),
      firstTimestamp: firstTs,
      lastTimestamp: lastTs,
      messageCount: ownCount + subCount,
      mainAgentMessages: ownCount,
      subAgentMessages: subCount,
      linesGenerated: cardLines,
      totalUsage: cardUsage,
      totalCost: cardCost,
      hasSubagents: kids.length > 0,
    });

    P.sessionCount += 1;
    P.totalMessages += ownCount + subCount;
    P.linesGenerated += cardLines;
    P.totalCost += cardCost;
    addUsage(P.totalUsage, cardUsage);
    if (firstTs && (!P.firstActivity || firstTs < P.firstActivity)) P.firstActivity = firstTs;
    if (lastTs && (!P.lastActivity || lastTs > P.lastActivity)) P.lastActivity = lastTs;
  }

  const projects = Array.from(byProject.values());
  for (const p of projects) {
    p.sessions.sort((a, b) => {
      const da = a.lastTimestamp ? new Date(a.lastTimestamp) : new Date(0);
      const dbb = b.lastTimestamp ? new Date(b.lastTimestamp) : new Date(0);
      return dbb - da;
    });
  }
  projects.sort((a, b) => {
    const da = a.lastActivity ? new Date(a.lastActivity) : new Date(0);
    const dbb = b.lastActivity ? new Date(b.lastActivity) : new Date(0);
    return dbb - da;
  });
  return projects;
}

function normalizeSessionId(sessionFile) {
  return String(sessionFile).replace(/\.jsonl$/, '');
}

// Build the subagent list for a session. When `taskByChild` is provided (from
// the parts scan), each agent also carries its spawn link (for the Gantt).
function buildAgents(sessionId, allSess, counts, taskByChild) {
  const agents = [];
  for (const child of allSess) {
    if (child.parent_id !== sessionId) continue;
    const spawn = taskByChild ? taskByChild.get(child.id) : null;
    agents.push({
      agentId: child.id,
      meta: {
        agentType: child.agent || agentTypeFromTitle(child.title),
        description: child.title || null,
        toolUseId: spawn?.callID || null,
      },
      firstTimestamp: MS(child.time_created),
      lastTimestamp: MS(child.time_updated || child.time_created),
      messageCount: counts.get(child.id) || 0,
      totalUsage: usageFromSessionRow(child),
      totalCost: child.cost || 0,
      model: modelLabel(child.model),
      skillsUsed: [],
      spawnedAt: spawn?.ts || null,
      spawnedByUuid: spawn?.messageId || null,
    });
  }
  agents.sort((a, b) => {
    const ta = a.firstTimestamp ? new Date(a.firstTimestamp) : new Date(0);
    const tb = b.firstTimestamp ? new Date(b.firstTimestamp) : new Date(0);
    return ta - tb;
  });
  return agents;
}

// Fast initial payload: session meta + subagents (from the session table) + the
// FIRST page of full messages. The heavy per-message timeline and aggregated
// tool bucket are deferred to getSessionInsights so opening a huge session is
// instant (the Gantt + tool panel are collapsed by default anyway).
function getSessionDetail(dirName, sessionFile) {
  const sessionId = normalizeSessionId(sessionFile);
  const allSess = allSessions();
  const s = allSess.find(x => x.id === sessionId);
  if (!s) throw new Error('Session not found');

  const firstPage = getMessagePage(sessionId, 0, MESSAGE_PAGE_SIZE);
  const counts = messageCountsBySession();
  const agents = buildAgents(sessionId, allSess, counts, null);

  const totalUsage = newUsage();
  addUsage(totalUsage, usageFromSessionRow(s));
  const messageCount = counts.get(sessionId) || firstPage.messages.length;

  return {
    sessionId: s.id,
    title: s.title || 'Untitled session',
    cwd: s.directory || null,
    gitBranch: null,
    model: modelLabel(s.model),
    firstTimestamp: MS(s.time_created),
    lastTimestamp: MS(s.time_updated || s.time_created),
    messageCount,
    mainAgentMessages: messageCount,
    subAgentMessages: agents.reduce((a, x) => a + x.messageCount, 0),
    totalUsage,
    totalCost: s.cost || 0,
    messages: firstPage.messages,
    messagePageSize: MESSAGE_PAGE_SIZE,
    messageNextOffset: firstPage.nextOffset,
    messagesDone: firstPage.done,
    agents,
    // timeline / convTools / sessionMcps / sessionSkills → deferred to /insights
  };
}

// Deferred, heavier payload: the compact per-message timeline (Gantt), the
// aggregated tool bucket, the MCP/skill sets, and subagents enriched with their
// spawn links. Built from a single scan of the session's parts.
function getSessionInsights(dirName, sessionFile) {
  const sessionId = normalizeSessionId(sessionFile);
  const allSess = allSessions();
  const s = allSess.find(x => x.id === sessionId);
  if (!s) throw new Error('Session not found');

  const { timeline, convTools, mcps, skills, taskByChild } = buildTimelineAndTools(sessionId);
  const counts = messageCountsBySession();
  const agents = buildAgents(sessionId, allSess, counts, taskByChild);

  return { timeline, convTools, sessionMcps: mcps, sessionSkills: skills, agents };
}

// One page of full message bodies for the scrollable list.
function getSessionMessagesPage(dirName, sessionFile, offset, limit) {
  const sessionId = normalizeSessionId(sessionFile);
  // Match the 404 behaviour of the other session routes instead of quietly
  // returning an empty page for a bogus session id.
  const exists = db().prepare(`SELECT 1 FROM session WHERE id = ? LIMIT 1`).get(sessionId);
  if (!exists) throw new Error('Session not found');
  return getMessagePage(sessionId, offset, Math.min(limit || MESSAGE_PAGE_SIZE, 500));
}

function agentTypeFromTitle(title) {
  if (!title) return '(unknown)';
  const m = title.match(/@(\w+)\s+subagent/i);
  return m ? m[1] : '(unknown)';
}

function getAgentDetail(dirName, sessionFile, agentId) {
  const sessionId = normalizeSessionId(agentId);
  const sessions = new Map(allSessions().map(s => [s.id, s]));
  const s = sessions.get(sessionId);
  if (!s) throw new Error('Agent not found');

  const messages = buildAllMessages(sessionId);
  const totalUsage = newUsage();
  addUsage(totalUsage, usageFromSessionRow(s));

  return {
    sessionId: s.id,
    title: s.title || 'Untitled session',
    cwd: s.directory || null,
    gitBranch: null,
    model: modelLabel(s.model),
    firstTimestamp: MS(s.time_created),
    lastTimestamp: MS(s.time_updated || s.time_created),
    messageCount: messages.length,
    mainAgentMessages: messages.length,
    subAgentMessages: 0,
    totalUsage,
    totalCost: s.cost || 0,
    messages,
    toolUseMap: {},
  };
}

function getStatsCache() {
  return null; // OpenCode has no stats-cache.json equivalent.
}

// ── tool usage (scans all tool parts; memoised like the Claude parser) ──
let _toolUsageCache = null;
let _toolUsageCacheAt = 0;
const TOOL_USAGE_TTL_MS = 60_000;

function getToolUsage() {
  if (_toolUsageCache && Date.now() - _toolUsageCacheAt < TOOL_USAGE_TTL_MS) return _toolUsageCache;
  const result = computeToolUsage();
  _toolUsageCache = result;
  _toolUsageCacheAt = Date.now();
  return result;
}

function computeToolUsage() {
  if (!DatabaseSync || !fs.existsSync(dbPath())) return { projects: [] };

  const sessions = allSessions();
  const projectBySession = new Map(sessions.map(s => [s.id, s.project_id]));

  const newBuckets = () => ({ tools: {}, skills: {}, mcpServers: {}, mcpTools: {}, agents: {}, totalCalls: 0 });
  const byProject = new Map();
  const bucket = (pid) => {
    if (!byProject.has(pid)) byProject.set(pid, { dirName: pid, ...newBuckets() });
    return byProject.get(pid);
  };

  // Tool calls. json_extract keeps the payload small (tool outputs stay in SQLite).
  const toolRows = db().prepare(
    `SELECT session_id AS sid,
            json_extract(data, '$.tool') AS tool,
            json_extract(data, '$.state.input.name') AS skillName
     FROM part WHERE json_extract(data, '$.type') = 'tool'`
  ).all();

  for (const r of toolRows) {
    const pid = projectBySession.get(r.sid);
    if (!pid) continue;
    const b = bucket(pid);
    b.totalCalls += 1;
    const c = classifyTool(r.tool);
    if (c.kind === 'agent') {
      // counted via child sessions below
    } else if (c.kind === 'mcp') {
      b.mcpServers[c.server] = (b.mcpServers[c.server] || 0) + 1;
      b.mcpTools[c.full] = (b.mcpTools[c.full] || 0) + 1;
    } else if (c.kind === 'skill') {
      const sk = r.skillName || '(skill)';
      b.skills[sk] = (b.skills[sk] || 0) + 1;
    } else {
      b.tools[c.name] = (b.tools[c.name] || 0) + 1;
    }
  }

  // Subagent types: one per child session, attributed to the child's project.
  for (const s of sessions) {
    if (!s.parent_id) continue;
    const pid = s.project_id;
    if (!pid) continue;
    const b = bucket(pid);
    const type = s.agent || agentTypeFromTitle(s.title);
    b.agents[type] = (b.agents[type] || 0) + 1;
  }

  return { projects: Array.from(byProject.values()) };
}

function calcCost() { return 0; } // cost is pre-computed by OpenCode

module.exports = {
  getAllProjects,
  getSessionDetail,
  getSessionInsights,
  getSessionMessagesPage,
  getAgentDetail,
  getStatsCache,
  getToolUsage,
  calcCost,
};
