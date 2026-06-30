const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

const MODEL_PRICING = {
  'claude-opus-4': { input: 15, output: 75, cache_write: 18.75, cache_read: 1.5 },
  'claude-opus-3': { input: 15, output: 75, cache_write: 18.75, cache_read: 1.5 },
  'claude-sonnet-4': { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 },
  'claude-sonnet-3-7': { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 },
  'claude-sonnet-3-5': { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 },
  'claude-haiku-4': { input: 0.8, output: 4, cache_write: 1.0, cache_read: 0.08 },
  'claude-haiku-3': { input: 0.25, output: 1.25, cache_write: 0.3, cache_read: 0.03 },
};

function getPricing(model) {
  if (!model) return null;
  for (const [key, p] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key)) return p;
  }
  return { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 };
}

function calcCost(usage, model) {
  const p = getPricing(model);
  if (!p) return 0;
  const M = 1_000_000;
  return (
    (usage.input_tokens || 0) * p.input / M +
    (usage.output_tokens || 0) * p.output / M +
    (usage.cache_creation_input_tokens || 0) * p.cache_write / M +
    (usage.cache_read_input_tokens || 0) * p.cache_read / M
  );
}

function decodePath(dirName) {
  return '/' + dirName.replace(/^-/, '').split('-').join('/');
}

function decodeProjectName(dirName) {
  const worktreeSep = '--claude-worktrees-';
  const base = dirName.includes(worktreeSep) ? dirName.split(worktreeSep)[0] : dirName;
  const full = decodePath(base);
  const parts = full.split('/').filter(Boolean);
  return parts[parts.length - 1] || full;
}

function parseLines(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').trim().split('\n')
      .filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

function parseSessionFile(filePath, lightMode = false) {
  const entries = parseLines(filePath);
  const messages = [];
  let title = null;
  let sessionId = null;
  let firstTimestamp = null;
  let lastTimestamp = null;
  const totalUsage = { input: 0, output: 0, cache_write: 0, cache_read: 0 };
  let totalCost = 0;
  let model = null;
  let cwd = null;
  let gitBranch = null;
  let mainAgentMessages = 0;
  let subAgentMessages = 0;
  // Map toolUseId → { timestamp, uuid } for agent spawn detection
  const toolUseMap = {};

  for (const entry of entries) {
    if (!sessionId && entry.sessionId) sessionId = entry.sessionId;
    if (!cwd && entry.cwd) cwd = entry.cwd;
    if (!gitBranch && entry.gitBranch) gitBranch = entry.gitBranch;

    if (entry.type === 'ai-title') { title = entry.aiTitle; continue; }

    if (entry.type === 'user' || entry.type === 'assistant') {
      const ts = entry.timestamp ? new Date(entry.timestamp) : null;
      if (ts) {
        if (!firstTimestamp || ts < firstTimestamp) firstTimestamp = ts;
        if (!lastTimestamp || ts > lastTimestamp) lastTimestamp = ts;
      }

      if (entry.type === 'assistant') {
        const msg = entry.message || {};
        if (msg.model && msg.model !== '<synthetic>') model = msg.model;
        const usage = msg.usage;
        if (usage) {
          totalUsage.input += usage.input_tokens || 0;
          totalUsage.output += usage.output_tokens || 0;
          totalUsage.cache_write += usage.cache_creation_input_tokens || 0;
          totalUsage.cache_read += usage.cache_read_input_tokens || 0;
          totalCost += calcCost(usage, msg.model || model);
        }
        // Index tool_use IDs → for linking to spawned agents
        if (!lightMode && Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block && block.type === 'tool_use' && block.id) {
              toolUseMap[block.id] = { timestamp: entry.timestamp, uuid: entry.uuid };
            }
          }
        }
      }

      if (entry.isSidechain) subAgentMessages++;
      else mainAgentMessages++;

      if (!lightMode) {
        messages.push({
          uuid: entry.uuid,
          parentUuid: entry.parentUuid,
          type: entry.type,
          timestamp: entry.timestamp,
          isSidechain: entry.isSidechain || false,
          content: entry.type === 'user'
            ? (entry.message?.content || '')
            : (entry.message?.content || []),
          usage: entry.message?.usage || null,
          model: entry.message?.model || null,
          stopReason: entry.message?.stop_reason || null,
        });
      }
    }
  }

  return {
    sessionId,
    title: title || 'Session sans titre',
    cwd,
    gitBranch,
    model,
    firstTimestamp: firstTimestamp?.toISOString() || null,
    lastTimestamp: lastTimestamp?.toISOString() || null,
    messageCount: lightMode ? (mainAgentMessages + subAgentMessages) : messages.length,
    mainAgentMessages,
    subAgentMessages,
    totalUsage,
    totalCost,
    messages: lightMode ? [] : messages,
    toolUseMap: lightMode ? {} : toolUseMap,
  };
}

function parseAgentFile(filePath) {
  return parseSessionFile(filePath, true);
}

function parseSubagents(sessionDir) {
  const subagentsDir = path.join(sessionDir, 'subagents');
  if (!fs.existsSync(subagentsDir)) return [];

  const metaFiles = fs.readdirSync(subagentsDir).filter(f => f.endsWith('.meta.json'));
  const agents = [];

  for (const metaFile of metaFiles) {
    const agentId = metaFile.replace('.meta.json', '');
    const jsonlPath = path.join(subagentsDir, agentId + '.jsonl');
    if (!fs.existsSync(jsonlPath)) continue;

    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(path.join(subagentsDir, metaFile), 'utf8')); } catch {}

    const parsed = parseAgentFile(jsonlPath);
    const { skills } = collectToolsUsed(jsonlPath);
    agents.push({
      agentId,
      meta,
      firstTimestamp: parsed.firstTimestamp,
      lastTimestamp: parsed.lastTimestamp,
      messageCount: parsed.messageCount,
      totalUsage: parsed.totalUsage,
      totalCost: parsed.totalCost,
      model: parsed.model,
      skillsUsed: [...skills],
    });
  }

  // Sort by start time
  agents.sort((a, b) => {
    const ta = a.firstTimestamp ? new Date(a.firstTimestamp) : new Date(0);
    const tb = b.firstTimestamp ? new Date(b.firstTimestamp) : new Date(0);
    return ta - tb;
  });

  return agents;
}

const WORKTREE_SEP = '--claude-worktrees-';

function projectNameFromCwd(cwd, isWorktree) {
  if (!cwd) return null;
  const base = isWorktree ? cwd.replace(/\/.claude\/worktrees\/[^/]+\/?$/, '') : cwd;
  const parts = base.split('/').filter(Boolean);
  return parts[parts.length - 1] || null;
}

function getAllProjects() {
  if (!fs.existsSync(PROJECTS_DIR)) return [];

  const projectDirs = fs.readdirSync(PROJECTS_DIR).filter(d => {
    return fs.statSync(path.join(PROJECTS_DIR, d)).isDirectory();
  });

  const byParent = new Map();

  for (const dirName of projectDirs) {
    const projectPath = path.join(PROJECTS_DIR, dirName);
    const sessionFiles = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'));
    if (sessionFiles.length === 0) continue;

    const isWorktree = dirName.includes(WORKTREE_SEP);
    const parentDirName = isWorktree ? dirName.split(WORKTREE_SEP)[0] : dirName;

    let totalCost = 0;
    let totalMessages = 0;
    let lastActivity = null;
    let firstActivity = null;
    const totalUsage = { input: 0, output: 0, cache_write: 0, cache_read: 0 };
    const sessions = [];
    let firstCwd = null;

    for (const sf of sessionFiles) {
      try {
        const session = parseSessionFile(path.join(projectPath, sf), true);
        if (!firstCwd && session.cwd) firstCwd = session.cwd;
        totalCost += session.totalCost;
        totalMessages += session.messageCount;
        totalUsage.input += session.totalUsage.input;
        totalUsage.output += session.totalUsage.output;
        totalUsage.cache_write += session.totalUsage.cache_write;
        totalUsage.cache_read += session.totalUsage.cache_read;

        if (session.lastTimestamp) {
          const d = new Date(session.lastTimestamp);
          if (!lastActivity || d > new Date(lastActivity)) lastActivity = session.lastTimestamp;
        }
        if (session.firstTimestamp) {
          const d = new Date(session.firstTimestamp);
          if (!firstActivity || d < new Date(firstActivity)) firstActivity = session.firstTimestamp;
        }

        const sessionId = sf.replace('.jsonl', '');
        const sessionDir = path.join(projectPath, sessionId);
        const hasSubagents = fs.existsSync(path.join(sessionDir, 'subagents'));

        sessions.push({
          projectDirName: dirName,
          sessionId: session.sessionId || sessionId,
          file: sf,
          title: session.title,
          cwd: session.cwd,
          gitBranch: session.gitBranch,
          model: session.model,
          firstTimestamp: session.firstTimestamp,
          lastTimestamp: session.lastTimestamp,
          messageCount: session.messageCount,
          mainAgentMessages: session.mainAgentMessages,
          subAgentMessages: session.subAgentMessages,
          totalUsage: session.totalUsage,
          totalCost: session.totalCost,
          hasSubagents,
        });
      } catch {}
    }

    const cwdName = projectNameFromCwd(firstCwd, isWorktree);
    const displayName = cwdName || decodeProjectName(parentDirName);
    const displayPath = firstCwd
      ? (isWorktree ? firstCwd.replace(/\/.claude\/worktrees\/[^/]+\/?$/, '') : firstCwd)
      : decodePath(parentDirName);

    if (byParent.has(parentDirName)) {
      const parent = byParent.get(parentDirName);
      parent.sessions.push(...sessions);
      parent.totalCost += totalCost;
      parent.totalMessages += totalMessages;
      parent.sessionCount += sessions.length;
      parent.totalUsage.input += totalUsage.input;
      parent.totalUsage.output += totalUsage.output;
      parent.totalUsage.cache_write += totalUsage.cache_write;
      parent.totalUsage.cache_read += totalUsage.cache_read;
      if (lastActivity && (!parent.lastActivity || new Date(lastActivity) > new Date(parent.lastActivity)))
        parent.lastActivity = lastActivity;
      if (firstActivity && (!parent.firstActivity || new Date(firstActivity) < new Date(parent.firstActivity)))
        parent.firstActivity = firstActivity;
      if (!parent._hasCwdName && cwdName) {
        parent.name = displayName;
        parent.path = displayPath;
        parent._hasCwdName = true;
      }
    } else {
      byParent.set(parentDirName, {
        dirName: parentDirName,
        name: displayName,
        path: displayPath,
        sessionCount: sessions.length,
        totalMessages,
        totalCost,
        totalUsage,
        firstActivity,
        lastActivity,
        sessions,
        _hasCwdName: !!cwdName,
      });
    }
  }

  const projects = Array.from(byParent.values());

  for (const p of projects) {
    delete p._hasCwdName;
    p.sessions.sort((a, b) => {
      const da = a.lastTimestamp ? new Date(a.lastTimestamp) : new Date(0);
      const db = b.lastTimestamp ? new Date(b.lastTimestamp) : new Date(0);
      return db - da;
    });
  }

  projects.sort((a, b) => {
    const da = a.lastActivity ? new Date(a.lastActivity) : new Date(0);
    const db = b.lastActivity ? new Date(b.lastActivity) : new Date(0);
    return db - da;
  });

  return projects;
}

function collectToolsUsed(filePath) {
  const mcps = new Set();
  const skills = new Set();
  for (const entry of parseLines(filePath)) {
    if (entry.type !== 'assistant') continue;
    for (const block of (entry.message?.content || [])) {
      if (!block || block.type !== 'tool_use') continue;
      if (block.name.startsWith('mcp__')) {
        const parts = block.name.split('__');
        const server = (parts[1] || '').replace(/^claude_ai_/, '').replace(/_/g, ' ');
        if (server) mcps.add(server);
      } else if (block.name === 'Skill' && block.input?.skill) {
        skills.add(block.input.skill);
      }
    }
  }
  return { mcps, skills };
}

function getSessionDetail(dirName, sessionFile) {
  const filePath = path.join(PROJECTS_DIR, dirName, sessionFile);
  if (!fs.existsSync(filePath)) throw new Error('Session not found');

  const session = parseSessionFile(filePath, false);

  // Load subagents if the session directory exists
  const sessionId = sessionFile.replace('.jsonl', '');
  const sessionDir = path.join(PROJECTS_DIR, dirName, sessionId);
  const agents = fs.existsSync(sessionDir) ? parseSubagents(sessionDir) : [];

  // Link each agent to its spawn event in main session via toolUseId
  for (const agent of agents) {
    if (agent.meta.toolUseId && session.toolUseMap[agent.meta.toolUseId]) {
      agent.spawnedAt = session.toolUseMap[agent.meta.toolUseId].timestamp;
      agent.spawnedByUuid = session.toolUseMap[agent.meta.toolUseId].uuid;
    }
  }

  // Aggregate MCPs and skills from main session + all subagent files
  const allMcps = new Set();
  const allSkills = new Set();
  const filesToScan = [filePath];
  const subagentsDir = path.join(sessionDir, 'subagents');
  if (fs.existsSync(subagentsDir)) {
    fs.readdirSync(subagentsDir).filter(f => f.endsWith('.jsonl'))
      .forEach(f => filesToScan.push(path.join(subagentsDir, f)));
  }
  for (const f of filesToScan) {
    const { mcps, skills } = collectToolsUsed(f);
    mcps.forEach(m => allMcps.add(m));
    skills.forEach(s => allSkills.add(s));
  }

  return { ...session, agents, sessionMcps: [...allMcps], sessionSkills: [...allSkills] };
}

function getAgentDetail(dirName, sessionFile, agentId) {
  const sessionId = sessionFile.replace('.jsonl', '');
  const agentPath = path.join(PROJECTS_DIR, dirName, sessionId, 'subagents', agentId + '.jsonl');
  if (!fs.existsSync(agentPath)) throw new Error('Agent not found');
  return parseSessionFile(agentPath, false);
}

function getStatsCache() {
  const statsFile = path.join(CLAUDE_DIR, 'stats-cache.json');
  if (!fs.existsSync(statsFile)) return null;
  try { return JSON.parse(fs.readFileSync(statsFile, 'utf8')); } catch { return null; }
}

module.exports = { getAllProjects, getSessionDetail, getAgentDetail, getStatsCache, calcCost };
