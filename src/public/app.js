/* ── State ── */
const state = {
  projects: null,
  stats: null,
  currentProject: null,
  currentSession: null,
  activityChart: null,
  ganttChart: null,
  ganttData: null,
  msgFilter: 'all',
  timelineOpen: false,
};

/* ── Utils ── */
const $ = id => document.getElementById(id);
const fmt = n => n == null ? '—' : n.toLocaleString('en-US');
const fmtCost = v => v < 0.001 ? '<$0.001' : '$' + v.toFixed(v < 0.01 ? 4 : v < 0.1 ? 3 : 2);
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtTime = iso => iso ? new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';

function fmtRelative(iso) {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return fmtDate(iso);
}

function fmtDuration(ms) {
  if (ms < 1000) return '<1s';
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

function fmtMillions(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'k';
  return fmt(n);
}

function modelShort(model) {
  if (!model || model === '<synthetic>') return '—';
  return model.replace('claude-', '').replace(/-\d{8}$/, '');
}

function escHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function show(loading) {
  $('loading').classList.toggle('hidden', !loading);
}

/* ── Navigation ── */
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $('view-' + name).classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(a => {
    a.classList.toggle('active', a.dataset.view === name || a.dataset.view === name.split('-')[0]);
  });
}

function pushUrl(params) {
  const qs = new URLSearchParams(params).toString();
  history.pushState(params, '', qs ? '?' + qs : location.pathname);
}

function restoreFromUrl() {
  const p = new URLSearchParams(location.search);
  const project = p.get('project');
  const session = p.get('session');
  if (project && session) return loadSessionDetail(encodeURIComponent(project), encodeURIComponent(session));
  if (project) return loadSessions(encodeURIComponent(project));
  loadDashboard();
}

window.addEventListener('popstate', e => {
  const d = e.state || {};
  if (d.session && d.project) loadSessionDetail(encodeURIComponent(d.project), encodeURIComponent(d.session));
  else if (d.project) loadSessions(encodeURIComponent(d.project));
  else loadDashboard();
});

function setBreadcrumb(parts) {
  $('breadcrumb').innerHTML = parts.map(p => `<div style="color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(p)}</div>`).join('');
}

/* ── API ── */
async function api(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

/* ── Dashboard ── */
async function loadDashboard() {
  pushUrl({});
  showView('dashboard');
  setBreadcrumb(['Dashboard']);
  const container = $('view-dashboard');

  if (!state.projects) {
    show(true);
    try {
      [state.projects, state.stats] = await Promise.all([api('/api/projects'), api('/api/stats')]);
    } finally { show(false); }
  }

  const projects = state.projects;
  const totalSessions = projects.reduce((s, p) => s + p.sessionCount, 0);
  const totalMsgs = projects.reduce((s, p) => s + p.totalMessages, 0);
  const totalCost = projects.reduce((s, p) => s + p.totalCost, 0);
  const totalInput = projects.reduce((s, p) => s + p.totalUsage.input, 0);
  const totalOutput = projects.reduce((s, p) => s + p.totalUsage.output, 0);
  const totalCacheW = projects.reduce((s, p) => s + p.totalUsage.cache_write, 0);
  const totalCacheR = projects.reduce((s, p) => s + p.totalUsage.cache_read, 0);

  container.innerHTML = `
    <div class="page-header">
      <h1>Dashboard</h1>
      <div class="subtitle">Overview of all your Claude Code sessions</div>
    </div>
    <div class="stats-grid">
      <div class="stat-card accent"><div class="label">Projects</div><div class="value">${fmt(projects.length)}</div></div>
      <div class="stat-card"><div class="label">Sessions</div><div class="value">${fmt(totalSessions)}</div></div>
      <div class="stat-card"><div class="label">Messages</div><div class="value">${fmt(totalMsgs)}</div></div>
      <div class="stat-card green"><div class="label">Estimated cost</div><div class="value">${fmtCost(totalCost)}</div></div>
      <div class="stat-card">
        <div class="label">Input tokens</div>
        <div class="value">${fmtMillions(totalInput)}</div>
        <div class="sub">+ ${fmtMillions(totalCacheR)} cache reads</div>
      </div>
      <div class="stat-card">
        <div class="label">Output tokens</div>
        <div class="value">${fmtMillions(totalOutput)}</div>
        <div class="sub">${fmtMillions(totalCacheW)} cache writes</div>
      </div>
    </div>
    <div class="chart-section" style="margin-bottom:28px">
      <h2>Daily activity</h2>
      <div class="chart-container" id="activity-chart"></div>
    </div>
    <div class="section-title" style="margin-bottom:12px">Projects <span style="font-weight:400;color:var(--text3)">(${projects.length})</span></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Project</th><th>Path</th><th>Sessions</th><th>Messages</th><th>Input</th><th>Output</th><th>Cost</th><th>Last activity</th></tr></thead>
        <tbody>
          ${projects.map(p => `
            <tr onclick="loadSessions('${encodeURIComponent(p.dirName)}')">
              <td class="td-name">${escHtml(p.name)}</td>
              <td class="td-path" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(p.path)}</td>
              <td class="td-num">${fmt(p.sessionCount)}</td>
              <td class="td-num">${fmt(p.totalMessages)}</td>
              <td class="td-num" style="color:var(--accent)">${fmtMillions(p.totalUsage.input)}</td>
              <td class="td-num" style="color:var(--green)">${fmtMillions(p.totalUsage.output)}</td>
              <td class="td-cost">${fmtCost(p.totalCost)}</td>
              <td class="td-date">${fmtRelative(p.lastActivity)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  initActivityChart();
}

function initActivityChart() {
  const el = document.getElementById('activity-chart');
  if (!el) return;
  if (state.activityChart) { state.activityChart.dispose(); state.activityChart = null; }

  const daily = state.stats?.dailyActivity || [];
  if (!daily.length) return;

  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  const chart = echarts.init(el);
  state.activityChart = chart;
  chart.setOption({
    color: ['rgba(79,142,247,0.7)', 'rgba(167,139,250,0.6)'],
    grid: { left: 36, right: 12, top: 28, bottom: 24 },
    legend: { top: 0, textStyle: { color: '#8892a4', fontSize: 11 } },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      backgroundColor: '#1a1e28', borderColor: '#1f2433',
      textStyle: { color: '#e2e8f0' },
      extraCssText: 'box-shadow:none',
    },
    xAxis: {
      type: 'category', data: sorted.map(d => d.date.slice(5)),
      axisLabel: { color: '#5a6478', fontSize: 10 },
      axisLine: { lineStyle: { color: '#1f2433' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#5a6478', fontSize: 10 },
      splitLine: { lineStyle: { color: '#1f2433' } },
    },
    series: [
      { name: 'Messages', type: 'bar', data: sorted.map(d => d.messageCount), itemStyle: { borderRadius: [3, 3, 0, 0] } },
      { name: 'Tool calls', type: 'bar', data: sorted.map(d => d.toolCallCount || 0), itemStyle: { borderRadius: [3, 3, 0, 0] } },
    ],
  });

  if (!state.activityChartResizeBound) {
    window.addEventListener('resize', () => state.activityChart?.resize());
    state.activityChartResizeBound = true;
  }
}

/* ── Sessions list ── */
async function loadSessions(dirNameEncoded) {
  const dirName = decodeURIComponent(dirNameEncoded);
  pushUrl({ project: dirName });
  showView('sessions');

  if (!state.projects) {
    show(true);
    try { state.projects = await api('/api/projects'); } finally { show(false); }
  }

  const project = state.projects.find(p => p.dirName === dirName);
  if (!project) return;
  state.currentProject = project;
  setBreadcrumb([project.path, 'Sessions']);

  const container = $('view-sessions');
  container.innerHTML = `
    <button class="back-btn" onclick="loadDashboard()">← Dashboard</button>
    <div class="page-header">
      <h1>${escHtml(project.name)}</h1>
      <div class="subtitle">${escHtml(project.path)}</div>
    </div>
    <div class="stats-grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">
      <div class="stat-card"><div class="label">Sessions</div><div class="value">${fmt(project.sessionCount)}</div></div>
      <div class="stat-card"><div class="label">Messages</div><div class="value">${fmt(project.totalMessages)}</div></div>
      <div class="stat-card green"><div class="label">Total cost</div><div class="value">${fmtCost(project.totalCost)}</div></div>
      <div class="stat-card accent"><div class="label">Input tokens</div><div class="value">${fmtMillions(project.totalUsage.input)}</div></div>
    </div>
    <div class="section-title" style="margin-bottom:12px">Sessions</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Title</th><th>Model</th><th>Messages</th><th>Agents</th><th>Input</th><th>Output</th><th>Cost</th><th>Date</th></tr></thead>
        <tbody>
          ${project.sessions.map(s => `
            <tr onclick="loadSessionDetail('${encodeURIComponent(dirName)}','${encodeURIComponent(s.file)}','${encodeURIComponent(s.projectDirName || dirName)}')">
              <td class="td-name" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                ${s.hasSubagents ? '<span style="color:var(--purple);margin-right:6px">⬡</span>' : ''}${escHtml(s.title)}
              </td>
              <td><span class="badge badge-model">${escHtml(modelShort(s.model))}</span></td>
              <td class="td-num">${fmt(s.messageCount)}</td>
              <td class="td-num">${s.hasSubagents ? `<span style="color:var(--purple)">agents</span>` : '<span style="color:var(--text3)">—</span>'}</td>
              <td class="td-num" style="color:var(--accent)">${fmtMillions(s.totalUsage.input)}</td>
              <td class="td-num" style="color:var(--green)">${fmtMillions(s.totalUsage.output)}</td>
              <td class="td-cost">${fmtCost(s.totalCost)}</td>
              <td class="td-date">${fmtDate(s.lastTimestamp)} ${fmtTime(s.lastTimestamp)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

/* ── Session detail ── */
async function loadSessionDetail(dirNameEncoded, fileEncoded, apiDirNameEncoded) {
  const dirName = decodeURIComponent(dirNameEncoded);
  const file = decodeURIComponent(fileEncoded);
  pushUrl({ project: dirName, session: file });
  showView('session-detail');
  const container = $('view-session-detail');
  container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3)">Loading...</div>';
  show(true);

  // Resolve the actual dir where the session file lives (may differ for merged worktrees)
  let apiDirName = apiDirNameEncoded ? decodeURIComponent(apiDirNameEncoded) : dirName;
  if (!apiDirNameEncoded) {
    if (!state.projects) {
      try { state.projects = await api('/api/projects'); } catch {}
    }
    const proj = state.projects?.find(p => p.dirName === dirName);
    const sess = proj?.sessions?.find(s => s.file === file);
    if (sess?.projectDirName) apiDirName = sess.projectDirName;
  }

  let session;
  try {
    session = await api(`/api/projects/${encodeURIComponent(apiDirName)}/sessions/${encodeURIComponent(file)}`);
  } catch (e) {
    container.innerHTML = `<div style="padding:40px;color:var(--red)">Error: ${escHtml(e.message)}</div>`;
    show(false);
    return;
  }
  show(false);
  state.currentSession = { session, dirName, apiDirName, file };
  state.msgFilter = 'all';
  state.timelineOpen = session.agents && session.agents.length > 0;

  if (!state.currentProject && state.projects) {
    state.currentProject = state.projects.find(p => p.dirName === dirName);
  }

  // Build map: message uuid → skills used by agents spawned from that message
  state.agentSkillsByUuid = {};
  if (session.agents) {
    for (const agent of session.agents) {
      if (agent.spawnedByUuid && agent.skillsUsed?.length) {
        const existing = state.agentSkillsByUuid[agent.spawnedByUuid] || [];
        for (const s of agent.skillsUsed) {
          if (!existing.includes(s)) existing.push(s);
        }
        state.agentSkillsByUuid[agent.spawnedByUuid] = existing;
      }
    }
  }

  setBreadcrumb([state.currentProject?.path || dirName, session.title]);
  renderSessionDetail(session, dirName, file);
}

function renderSessionDetail(session, dirName, file) {
  const container = $('view-session-detail');
  const { totalUsage, totalCost, model, cwd, gitBranch, firstTimestamp, lastTimestamp, mainAgentMessages, subAgentMessages, agents } = session;

  const durationMs = firstTimestamp && lastTimestamp
    ? new Date(lastTimestamp) - new Date(firstTimestamp) : null;
  const hasAgents = agents && agents.length > 0;

  // MCPs and skills pre-aggregated server-side (main + all subagents)
  const mcpBar = session.sessionMcps?.length
    ? `<div class="session-tools-bar">${session.sessionMcps.map(s => `<span class="usage-chip"><span class="tag-mcp">mcp</span>${escHtml(s)}</span>`).join('')}</div>`
    : '';
  const skillBar = session.sessionSkills?.length
    ? `<div class="session-tools-bar">${session.sessionSkills.map(s => `<span class="usage-chip"><span class="tag-skill">skill</span>${escHtml(s)}</span>`).join('')}</div>`
    : '';

  container.innerHTML = `
    <button class="back-btn" onclick="loadSessions('${encodeURIComponent(dirName)}')">← Sessions</button>
    <div class="page-header">
      <h1 style="font-size:18px">${escHtml(session.title)}</h1>
    </div>
    <div class="session-meta">
      <div class="meta-item"><div class="meta-label">Model</div><div class="meta-value accent">${escHtml(modelShort(model))}</div></div>
      <div class="meta-item"><div class="meta-label">Start</div><div class="meta-value">${fmtDate(firstTimestamp)} ${fmtTime(firstTimestamp)}</div></div>
      <div class="meta-item"><div class="meta-label">Duration</div><div class="meta-value">${durationMs != null ? fmtDuration(durationMs) : '—'}</div></div>
      <div class="meta-item"><div class="meta-label">Messages</div><div class="meta-value">${fmt(session.messageCount)}</div></div>
      ${hasAgents ? `<div class="meta-item"><div class="meta-label">Agents</div><div class="meta-value" style="color:var(--purple)">${fmt(agents.length)}</div></div>` : ''}
      ${cwd ? `<div class="meta-item"><div class="meta-label">Directory</div><div class="meta-value mono">${escHtml(cwd.replace('/home/olivier-j/', '~/'))}</div></div>` : ''}
      ${gitBranch && gitBranch !== 'HEAD' ? `<div class="meta-item"><div class="meta-label">Branch</div><div class="meta-value mono" style="color:var(--green)">${escHtml(gitBranch)}</div></div>` : ''}
    </div>
    ${mcpBar}${skillBar}

    <div class="token-bar">
      <div class="token-item"><div class="token-label">Input</div><div class="token-value input">${fmt(totalUsage.input)}</div></div>
      <div class="token-item"><div class="token-label">Output</div><div class="token-value output">${fmt(totalUsage.output)}</div></div>
      <div class="token-item"><div class="token-label">Cache written</div><div class="token-value cache-w">${fmt(totalUsage.cache_write)}</div></div>
      <div class="token-item"><div class="token-label">Cache read</div><div class="token-value cache-r">${fmt(totalUsage.cache_read)}</div></div>
      <div class="token-item" style="margin-left:auto"><div class="token-label">Estimated cost</div><div class="token-value cost">${fmtCost(totalCost)}</div></div>
    </div>

    <!-- Timeline toggle -->
    <div class="timeline-toggle${state.timelineOpen ? ' open' : ''}" onclick="toggleTimeline('${escHtml(dirName)}', '${escHtml(file)}')">
      <span class="tl-icon">⬡</span>
      <span>Timeline${hasAgents ? ` — ${agents.length} agent${agents.length > 1 ? 's' : ''}` : ''}</span>
      <span id="tl-chevron" style="margin-left:auto;font-size:10px;transition:transform 0.2s">${state.timelineOpen ? '▲' : '▼'}</span>
    </div>
    <div id="timeline-section" style="display:${state.timelineOpen ? 'block' : 'none'}">
      <div id="timeline-content" class="timeline-wrap">
        ${buildGanttContainer(session)}
      </div>
      <div id="timeline-detail" class="tl-detail hidden"></div>
    </div>

    ${hasAgents || subAgentMessages > 0 ? `
    <div class="filter-bar">
      <span style="font-size:12px;color:var(--text3)">Messages:</span>
      <button class="filter-btn active" data-filter="all" onclick="setMsgFilter('all','${encodeURIComponent(dirName)}','${encodeURIComponent(file)}')">All (${fmt(session.messageCount)})</button>
      <button class="filter-btn" data-filter="main" onclick="setMsgFilter('main','${encodeURIComponent(dirName)}','${encodeURIComponent(file)}')">Main thread (${fmt(mainAgentMessages)})</button>
    </div>` : ''}

    <div id="messages-list" class="messages-container">
      ${renderMessages(session.messages)}
    </div>`;

  state.ganttChart = null;
  if (state.timelineOpen) renderGanttChart(session, dirName, file);
}

/* ── Timeline / Gantt ── */
function toggleTimeline(dirName, file) {
  state.timelineOpen = !state.timelineOpen;
  const section = $('timeline-section');
  const chevron = $('tl-chevron');
  const toggle = document.querySelector('.timeline-toggle');
  if (section) section.style.display = state.timelineOpen ? 'block' : 'none';
  if (chevron) chevron.textContent = state.timelineOpen ? '▲' : '▼';
  if (toggle) toggle.classList.toggle('open', state.timelineOpen);

  if (state.timelineOpen) {
    if (!state.ganttChart) {
      renderGanttChart(state.currentSession.session, dirName, file);
    } else {
      state.ganttChart.resize();
    }
  }
}

const AGENT_COLORS = ['#a78bfa', '#2dd4bf', '#34d399', '#f97316', '#60a5fa', '#f87171', '#fbbf24', '#c084fc', '#38bdf8', '#4ade80'];

const GANTT_LABEL_W = 120;
const GANTT_ROW_H = 32;
const GANTT_TOP = 14;
const GANTT_BOTTOM = 34;

function computeGanttData(session) {
  const { messages, agents } = session;
  const timeMsgs = messages.filter(m => m.timestamp && (m.type === 'user' || m.type === 'assistant'));
  if (timeMsgs.length === 0) return { empty: 'No time data' };

  const hasAgents = agents && agents.length > 0;

  let tMin = Math.min(...timeMsgs.map(m => new Date(m.timestamp).getTime()));
  let tMax = Math.max(...timeMsgs.map(m => new Date(m.timestamp).getTime()));
  if (hasAgents) {
    for (const a of agents) {
      if (a.firstTimestamp) tMin = Math.min(tMin, new Date(a.firstTimestamp).getTime());
      if (a.lastTimestamp) tMax = Math.max(tMax, new Date(a.lastTimestamp).getTime());
    }
  }
  tMax += Math.max(5000, (tMax - tMin) * 0.02);
  if (tMax - tMin <= 0) return { empty: 'Instant session' };

  const categories = ['👤 User', '🤖 Main AI'];
  if (hasAgents) {
    for (const agent of agents) categories.push(agent.meta?.description || agent.agentId || '');
  }

  const shapes = [];

  // ── User ticks ──
  const userMsgs = timeMsgs.filter(m => m.type === 'user');
  for (const m of userMsgs) {
    const t = new Date(m.timestamp).getTime();
    shapes.push({
      kind: 'tick', catIndex: 0, x0: t, x1: t,
      color: '#fbbf24',
      uuid: m.uuid || null,
      tooltip: `<strong>User</strong> ${fmtTime(m.timestamp)}`,
    });
  }

  // ── Main AI row background + bars ──
  shapes.push({ kind: 'rowBg', catIndex: 1, x0: tMin, x1: tMax, color: '#4f8ef7', opacity: 0.06 });

  const assistMsgs = timeMsgs.filter(m => m.type === 'assistant');
  for (let i = 0; i < assistMsgs.length; i++) {
    const m = assistMsgs[i];
    const nextM = assistMsgs[i + 1];
    const startMs = new Date(m.timestamp).getTime();
    const endMs = nextM ? new Date(nextM.timestamp).getTime() : Math.min(startMs + 30000, tMax);

    const content = Array.isArray(m.content) ? m.content : [];
    const tools = content.filter(c => c && c.type === 'tool_use');
    const hasAgentTool = tools.some(t => t.name === 'Agent');
    const color = hasAgentTool ? '#a78bfa' : '#4f8ef7';
    const label = tools.slice(0, 2).map(t => t.name.replace(/([A-Z])/g, ' $1').trim()).join(', ');

    shapes.push({
      kind: 'bar', catIndex: 1, x0: startMs, x1: endMs,
      color, opacity: 0.85, minWidth: 4,
      uuid: m.uuid || null,
      label, labelMinWidth: 50,
      tooltip: `<strong>Assistant</strong> ${fmtTime(m.timestamp)}${tools.length ? `<br><span style="color:#a78bfa">${escHtml(tools.map(t => t.name).join(', '))}</span>` : ''}${m.usage ? `<br>in:${fmt(m.usage.input_tokens)} out:${fmt(m.usage.output_tokens)}` : ''}`,
    });
  }

  // ── Agent rows ──
  if (hasAgents) {
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      const catIndex = 2 + i;
      const color = AGENT_COLORS[i % AGENT_COLORS.length];

      shapes.push({ kind: 'rowBg', catIndex, x0: tMin, x1: tMax, color, opacity: 0.05 });

      if (agent.firstTimestamp && agent.lastTimestamp) {
        const startMs = new Date(agent.firstTimestamp).getTime();
        const endMs = new Date(agent.lastTimestamp).getTime();

        if (agent.spawnedAt) {
          shapes.push({
            kind: 'connector',
            x0: new Date(agent.spawnedAt).getTime(), catIndexFrom: 1,
            x1: startMs, catIndexTo: catIndex,
            color,
          });
        }

        const depth = agent.meta?.spawnDepth || 1;
        const info = `${fmtCost(agent.totalCost)} · ${agent.messageCount}msg`;
        shapes.push({
          kind: 'bar', catIndex, x0: startMs, x1: endMs,
          color, opacity: 0.8, minWidth: 6,
          borderColor: depth > 1 ? color : null, borderWidth: depth > 1 ? 1.5 : 0,
          agentId: agent.agentId,
          label: info, labelMinWidth: 40,
          tooltip: `<strong>${escHtml(agent.meta?.description || agent.agentId)}</strong><br>${agent.messageCount} msgs · ${fmtCost(agent.totalCost)} · ${fmtDuration(endMs - startMs)}`,
        });
      }
    }
  }

  const height = GANTT_TOP + categories.length * GANTT_ROW_H + GANTT_BOTTOM;
  return { categories, shapes, tMin, tMax, height };
}

function buildGanttContainer(session) {
  const data = computeGanttData(session);
  state.ganttData = data;
  if (data.empty) return `<div style="padding:20px;color:var(--text3);text-align:center">${data.empty}</div>`;
  return `<div id="gantt-chart" style="width:100%;height:${data.height}px"></div>`;
}

function renderGanttChart(session, dirName, file) {
  const el = document.getElementById('gantt-chart');
  if (!el) return;
  const data = state.ganttData || computeGanttData(session);
  if (data.empty) return;

  if (state.ganttChart) { state.ganttChart.dispose(); state.ganttChart = null; }
  const chart = echarts.init(el);
  state.ganttChart = chart;

  const { categories, shapes, tMin, tMax } = data;

  function renderItem(params, api) {
    const s = shapes[params.dataIndex];
    const rowH = api.size([0, 1])[1];

    if (s.kind === 'tick') {
      const p = api.coord([s.x0, s.catIndex]);
      const w = 3, h = rowH * 0.7;
      return { type: 'rect', shape: { x: p[0] - w / 2, y: p[1] - h / 2, width: w, height: h }, style: { fill: s.color, opacity: 0.9 }, cursor: s.uuid ? 'pointer' : 'default' };
    }

    if (s.kind === 'rowBg') {
      const p0 = api.coord([s.x0, s.catIndex]);
      const p1 = api.coord([s.x1, s.catIndex]);
      const h = rowH * 0.92;
      return { type: 'rect', shape: { x: p0[0], y: p0[1] - h / 2, width: p1[0] - p0[0], height: h }, style: { fill: s.color, opacity: s.opacity }, silent: true };
    }

    if (s.kind === 'connector') {
      const p0 = api.coord([s.x0, s.catIndexFrom]);
      const p1 = api.coord([s.x1, s.catIndexTo]);
      return { type: 'line', shape: { x1: p0[0], y1: p0[1], x2: p1[0], y2: p1[1] }, style: { stroke: s.color, lineWidth: 1, lineDash: [4, 3], opacity: 0.35 }, silent: true };
    }

    // 'bar' — Main AI segment or agent span
    const start = api.coord([s.x0, s.catIndex]);
    const end = api.coord([s.x1, s.catIndex]);
    const h = rowH * 0.65;
    const w = Math.max(s.minWidth, end[0] - start[0]);
    const children = [{
      type: 'rect',
      shape: { x: start[0], y: start[1] - h / 2, width: w, height: h, r: 2 },
      style: { fill: s.color, opacity: s.opacity, stroke: s.borderColor || undefined, lineWidth: s.borderWidth || 0 },
    }];
    if (s.label && w > s.labelMinWidth) {
      children.push({
        type: 'text',
        style: { text: s.label.slice(0, Math.floor(w / 6)), x: start[0] + 4, y: start[1] + h / 2 - 4, fill: '#fff', fontSize: 8, opacity: 0.85 },
      });
    }
    return { type: 'group', children, cursor: (s.uuid || s.agentId) ? 'pointer' : 'default' };
  }

  chart.setOption({
    grid: { left: GANTT_LABEL_W, right: 16, top: GANTT_TOP, bottom: GANTT_BOTTOM },
    xAxis: {
      type: 'value', min: tMin, max: tMax,
      axisLabel: { color: '#5a6478', fontSize: 9, formatter: v => fmtDuration(v - tMin) },
      axisLine: { lineStyle: { color: '#252b3a' } },
      axisTick: { lineStyle: { color: '#2e3650' } },
      splitLine: { lineStyle: { color: '#1a1e28' } },
    },
    yAxis: {
      type: 'category', data: categories, inverse: true,
      axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
      axisLabel: { color: '#5a6478', fontSize: 10, width: GANTT_LABEL_W - 16, overflow: 'truncate' },
    },
    tooltip: {
      trigger: 'item',
      backgroundColor: '#1a1e28', borderColor: '#1f2433',
      textStyle: { color: '#e2e8f0', fontSize: 12 },
      extraCssText: 'box-shadow:none',
      formatter: params => shapes[params.dataIndex]?.tooltip || '',
    },
    series: [{
      type: 'custom',
      renderItem,
      encode: { x: [1, 2], y: 0 },
      data: shapes.map(s => [s.catIndex !== undefined ? s.catIndex : s.catIndexTo, s.x0, s.x1]),
    }],
  });

  chart.on('click', params => {
    const s = shapes[params.dataIndex];
    if (!s) return;
    if (s.agentId) showTimelineAgentDetail(session, dirName, file, s.agentId);
    else if (s.uuid) showTimelineMessageDetail(session, s.uuid);
  });

  if (!state.ganttChartResizeBound) {
    window.addEventListener('resize', () => state.ganttChart?.resize());
    state.ganttChartResizeBound = true;
  }
}

/* ── Timeline detail panel ── */
function showTimelineMessageDetail(session, uuid) {
  const panel = $('timeline-detail');
  if (!panel) return;
  const msg = session.messages.find(m => m.uuid === uuid);
  if (!msg) return;

  const isUser = msg.type === 'user';
  const ts = msg.timestamp ? `${fmtDate(msg.timestamp)} ${fmtTime(msg.timestamp)}` : '';
  const content = Array.isArray(msg.content) ? msg.content : (typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : []);
  const tools = content.filter(b => b?.type === 'tool_use');
  const texts = content.filter(b => b?.type === 'text').map(b => b.text).join('\n');
  const toolResults = content.filter(b => b?.type === 'tool_result');

  let body = '';
  if (isUser) {
    if (toolResults.length > 0) {
      body = toolResults.map(tr => {
        const rc = Array.isArray(tr.content) ? tr.content.map(c => c.text || '').join('\n') : (tr.content || '');
        return `<div class="tool-call" style="${tr.is_error ? 'border-color:var(--red)' : ''}">
          <div class="tool-name" style="color:${tr.is_error ? 'var(--red)' : 'var(--teal)'}">↩ result${tr.is_error ? ' (error)' : ''}</div>
          <div class="tool-input">${escHtml(rc.slice(0, 800))}</div>
        </div>`;
      }).join('');
    } else if (texts) {
      body = `<div class="msg-text">${escHtml(texts)}</div>`;
    }
  } else {
    if (texts) body += `<div class="msg-text" style="margin-bottom:${tools.length ? '12px' : '0'}">${escHtml(texts.slice(0, 1000))}</div>`;
    if (tools.length) {
      body += tools.map(t => {
        const preview = getToolInputPreview(t.name, t.input);
        return `<div class="tool-call">
          <div class="tool-name">⚙ ${escHtml(t.name)}${preview ? `<span style="color:var(--text3);font-weight:400;margin-left:8px">${escHtml(preview.slice(0, 80))}</span>` : ''}</div>
        </div>`;
      }).join('');
    }
    if (msg.usage) {
      body += `<div class="usage-inline">
        <span class="usage-chip">in: <span class="in">${fmt(msg.usage.input_tokens)}</span></span>
        <span class="usage-chip">out: <span class="out">${fmt(msg.usage.output_tokens)}</span></span>
        ${msg.usage.cache_read_input_tokens ? `<span class="usage-chip">cache↓: <span class="cr">${fmt(msg.usage.cache_read_input_tokens)}</span></span>` : ''}
      </div>`;
    }
  }

  panel.innerHTML = `
    <div class="tl-detail-header">
      <span class="msg-role ${isUser ? 'user' : 'assistant'}">${isUser ? '👤 User' : '🤖 Assistant'}</span>
      <span style="color:var(--text3);font-size:11px;margin-left:8px">${ts}</span>
      <button class="tl-detail-close" onclick="$('timeline-detail').classList.add('hidden')">×</button>
    </div>
    <div class="tl-detail-body">${body || '<span style="color:var(--text3)">Empty content</span>'}</div>`;
  panel.classList.remove('hidden');
}

async function showTimelineAgentDetail(session, dirName, file, agentId) {
  const agent = session.agents?.find(a => a.agentId === agentId);
  if (!agent) return;

  const dur = agent.firstTimestamp && agent.lastTimestamp
    ? fmtDuration(new Date(agent.lastTimestamp) - new Date(agent.firstTimestamp)) : '—';

  let modal = $('agent-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'agent-modal';
    modal.className = 'agent-modal';
    modal.addEventListener('click', e => { if (e.target === modal) closeAgentModal(); });
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="agent-modal-box">
      <div class="agent-modal-header">
        <div style="min-width:0">
          <div style="font-size:14px;font-weight:600;color:var(--purple);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ⬡ ${escHtml(agent.meta?.description || agentId)}
          </div>
          <div style="font-size:11px;color:var(--text3);margin-top:3px">
            ${escHtml(agent.meta?.agentType || '')} · depth ${agent.meta?.spawnDepth || 1} · ${agent.messageCount} msgs · ${dur} · ${fmtCost(agent.totalCost)}
          </div>
        </div>
        <button onclick="closeAgentModal()" class="modal-close-btn">×</button>
      </div>
      <div class="agent-modal-loading" id="agent-modal-body">
        <div style="text-align:center;color:var(--text3);padding:40px">Loading…</div>
      </div>
    </div>`;
  modal.style.display = 'flex';

  try {
    const apiDirName = state.currentSession?.apiDirName || dirName;
    const detail = await api(`/api/projects/${encodeURIComponent(apiDirName)}/sessions/${encodeURIComponent(file)}/agents/${encodeURIComponent(agentId)}`);
    $('agent-modal-body').className = 'agent-modal-body';
    $('agent-modal-body').innerHTML = `
      <div class="agent-modal-stats">
        <div class="token-item"><div class="token-label">Input</div><div class="token-value input">${fmt(detail.totalUsage.input)}</div></div>
        <div class="token-item"><div class="token-label">Output</div><div class="token-value output">${fmt(detail.totalUsage.output)}</div></div>
        <div class="token-item"><div class="token-label">Cache read</div><div class="token-value cache-r">${fmt(detail.totalUsage.cache_read)}</div></div>
        <div class="token-item" style="margin-left:auto"><div class="token-label">Cost</div><div class="token-value cost">${fmtCost(detail.totalCost)}</div></div>
      </div>
      <div class="agent-modal-messages">
        ${renderAgentMessages(detail.messages)}
      </div>`;
  } catch (e) {
    $('agent-modal-body').innerHTML = `<div style="color:var(--red);padding:20px">Error: ${escHtml(e.message)}</div>`;
  }
}

function renderAgentSummary(detail) {
  const msgs = detail.messages;
  const dur = detail.firstTimestamp && detail.lastTimestamp
    ? fmtDuration(new Date(detail.lastTimestamp) - new Date(detail.firstTimestamp)) : '—';

  // Extract: task prompt (first user text), tool calls sequence, final answer
  const firstUserMsg = msgs.find(m => m.type === 'user');
  const taskText = extractText(firstUserMsg?.content);

  // Collect all tool_use calls in order
  const toolCalls = [];
  for (const m of msgs) {
    if (m.type !== 'assistant') continue;
    const content = Array.isArray(m.content) ? m.content : [];
    for (const block of content) {
      if (block?.type === 'tool_use') {
        toolCalls.push({ name: block.name, input: block.input, ts: m.timestamp });
      }
    }
  }

  // Final assistant text response
  let finalText = '';
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.type !== 'assistant') continue;
    const content = Array.isArray(m.content) ? m.content : [];
    const text = content.find(b => b?.type === 'text')?.text || '';
    if (text.trim()) { finalText = text; break; }
  }

  // Group tool calls by name for summary
  const toolCount = {};
  for (const t of toolCalls) toolCount[t.name] = (toolCount[t.name] || 0) + 1;

  return `
    <div class="token-bar" style="margin-bottom:16px">
      <div class="token-item"><div class="token-label">Input</div><div class="token-value input">${fmt(detail.totalUsage.input)}</div></div>
      <div class="token-item"><div class="token-label">Output</div><div class="token-value output">${fmt(detail.totalUsage.output)}</div></div>
      <div class="token-item"><div class="token-label">Duration</div><div class="token-value" style="color:var(--text2)">${dur}</div></div>
      <div class="token-item" style="margin-left:auto"><div class="token-label">Cost</div><div class="token-value cost">${fmtCost(detail.totalCost)}</div></div>
    </div>

    ${taskText ? `
    <div class="agent-section">
      <div class="agent-section-label">📋 Task</div>
      <div class="agent-task-text">${escHtml(taskText.slice(0, 600))}${taskText.length > 600 ? '…' : ''}</div>
    </div>` : ''}

    <div class="agent-section">
      <div class="agent-section-label">⚙ Tools used — ${toolCalls.length} calls</div>
      <div class="tool-summary-chips">
        ${Object.entries(toolCount).sort((a,b) => b[1]-a[1]).map(([name, count]) =>
          `<span class="tool-chip">${escHtml(name)}<span class="tool-chip-count">${count}</span></span>`
        ).join('')}
      </div>
    </div>

    <div class="agent-section">
      <div class="agent-section-label">📜 Call sequence</div>
      <div class="tool-sequence">
        ${toolCalls.slice(0, 60).map((t, i) => {
          const inputPreview = getToolInputPreview(t.name, t.input);
          return `<div class="tool-seq-item">
            <span class="tool-seq-num">${i + 1}</span>
            <span class="tool-seq-name">${escHtml(t.name)}</span>
            ${inputPreview ? `<span class="tool-seq-preview">${escHtml(inputPreview)}</span>` : ''}
          </div>`;
        }).join('')}
        ${toolCalls.length > 60 ? `<div style="color:var(--text3);font-size:11px;padding:4px 0">… and ${toolCalls.length - 60} more calls</div>` : ''}
      </div>
    </div>

    ${finalText ? `
    <div class="agent-section">
      <div class="agent-section-label">✅ Final result</div>
      <div class="agent-result-text">${escHtml(finalText.slice(0, 1200))}${finalText.length > 1200 ? '…' : ''}</div>
    </div>` : ''}

    <div style="padding:12px 0 4px">
      <button class="filter-btn" onclick="showAllAgentMessages(${JSON.stringify(detail.messages.length)})" style="font-size:12px">
        Show all messages (${detail.messages.length})
      </button>
    </div>

    <div id="agent-all-messages" class="hidden">
      <div class="messages-container" style="margin-top:12px">
        ${renderAgentMessages(msgs)}
      </div>
    </div>`;
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter(b => b?.type === 'text').map(b => b.text).join('\n') ||
           content.filter(b => typeof b === 'string').join('\n');
  }
  return '';
}

function getToolInputPreview(name, input) {
  if (!input) return '';
  if (name === 'Bash' || name === 'bash') return (input.command || '').slice(0, 60);
  if (name === 'Read') return input.file_path || '';
  if (name === 'Edit' || name === 'Write') return input.file_path || '';
  if (name === 'WebSearch' || name === 'WebFetch') return input.query || input.url || '';
  if (name === 'Agent') return (input.description || input.prompt || '').slice(0, 60);
  if (name === 'Skill') return input.skill || '';
  // Generic: first string value
  const vals = Object.values(input).filter(v => typeof v === 'string');
  return vals[0]?.slice(0, 60) || '';
}

function renderAgentMessages(msgs) {
  // Show only "significant" messages: user text + assistant text (skip pure tool_result exchanges)
  return msgs.map((m, i) => {
    const isUser = m.type === 'user';
    const content = Array.isArray(m.content) ? m.content : (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : []);
    const hasText = content.some(b => b?.type === 'text' && b.text?.trim());
    const isToolResult = !isUser ? false : content.every(b => b?.type === 'tool_result' || !b);
    const collapseByDefault = isToolResult || i > 2;

    const bodyParts = [];
    if (isUser) {
      if (isToolResult) {
        bodyParts.push(`<div style="color:var(--text3);font-size:12px">↩ ${content.length} tool result(s)</div>`);
      } else {
        const text = extractText(m.content);
        if (text) bodyParts.push(`<div class="msg-text">${escHtml(text.slice(0, 500))}</div>`);
      }
    } else {
      for (const block of content) {
        if (!block) continue;
        if (block.type === 'thinking') {
          bodyParts.push(`<div class="thinking-block">🧠 thinking (${block.thinking?.length || 0} chars)</div>`);
        } else if (block.type === 'text' && block.text?.trim()) {
          bodyParts.push(`<div class="msg-text">${escHtml(block.text.slice(0, 800))}</div>`);
        } else if (block.type === 'tool_use') {
          const preview = getToolInputPreview(block.name, block.input);
          bodyParts.push(`<div class="tool-call" style="padding:6px 10px;margin:4px 0">
            <span class="tool-name" style="font-size:11px">⚙ ${escHtml(block.name)}</span>
            ${preview ? `<span style="color:var(--text3);font-size:11px;margin-left:8px">${escHtml(preview)}</span>` : ''}
          </div>`);
        }
      }
    }

    const ts = m.timestamp ? fmtTime(m.timestamp) : '';
    return `
      <div class="message ${collapseByDefault ? 'collapsed' : ''}" style="margin-bottom:6px">
        <div class="message-header" onclick="this.parentElement.classList.toggle('collapsed')" style="padding:7px 12px">
          <span class="msg-role ${isUser ? 'user' : 'assistant'}" style="font-size:10px">${isUser ? '👤' : '🤖'} ${isUser ? (isToolResult ? 'tool result' : 'user') : 'assistant'}</span>
          ${ts ? `<span style="font-size:10px;color:var(--text3);margin-left:8px">${ts}</span>` : ''}
          <span class="msg-chevron" style="margin-left:auto">▼</span>
        </div>
        <div class="message-body" style="padding:10px 12px">${bodyParts.join('') || '<div style="color:var(--text3);font-size:11px">empty</div>'}</div>
      </div>`;
  }).join('');
}

function showAllAgentMessages(count) {
  $('agent-all-messages')?.classList.toggle('hidden');
}

function closeAgentModal() {
  const modal = $('agent-modal');
  if (modal) modal.style.display = 'none';
}

/* ── Messages ── */
function setMsgFilter(filter, dirNameEnc, fileEnc) {
  state.msgFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
  if (state.currentSession) {
    $('messages-list').innerHTML = renderMessages(state.currentSession.session.messages);
  }
}

function renderMessages(messages, ctx) {
  const filtered = messages.filter(m => {
    if (state.msgFilter === 'main') return !m.isSidechain;
    return true;
  });
  if (!filtered.length) return '<div class="empty"><p>No messages</p></div>';

  // Track active skill/agent context across messages
  let activeAgent = null;
  return filtered.map((m, i) => {
    if (m.type === 'assistant') {
      const content = Array.isArray(m.content) ? m.content : [];
      for (const block of content) {
        if (!block || block.type !== 'tool_use') continue;
        if (block.name === 'Skill') {
          activeAgent = { kind: 'skill', name: block.input?.skill || '?' };
        } else if (block.name === 'Agent') {
          const name = block.input?.description || block.input?.subagent_type || 'agent';
          activeAgent = { kind: 'agent', name: name.slice(0, 40) };
        }
      }
    }
    return renderMessage(m, i, ctx, activeAgent);
  }).join('');
}

function renderMessage(m, i, ctx, activeAgent) {
  const isUser = m.type === 'user';
  const isAgent = m.isSidechain;
  const collapseByDefault = !isUser && i > 0;
  const pfx = ctx === 'modal' ? 'modal-' : '';

  // Extract tool info for assistant messages (used in header hint + usage chips)
  const msgToolNames = [];
  const mcpServers = [];
  const skillsUsed = [];
  if (!isUser) {
    const contentArr = Array.isArray(m.content) ? m.content : [];
    for (const block of contentArr) {
      if (!block || block.type !== 'tool_use') continue;
      msgToolNames.push(block.name);
      if (block.name.startsWith('mcp__')) {
        const parts = block.name.split('__');
        const server = (parts[1] || '').replace(/^claude_ai_/, '').replace(/_/g, ' ');
        if (server && !mcpServers.includes(server)) mcpServers.push(server);
      } else if (block.name === 'Skill' && block.input?.skill) {
        const sn = block.input.skill;
        if (!skillsUsed.includes(sn)) skillsUsed.push(sn);
      }
    }
  }
  // Build a human-readable hint for the collapsed header
  let toolHint = '';
  if (!isUser && msgToolNames.length > 0) {
    const hintParts = [];
    // Agent spawns: show description
    const contentArr2 = Array.isArray(m.content) ? m.content : [];
    for (const block of contentArr2) {
      if (!block || block.type !== 'tool_use') continue;
      if (block.name === 'Agent') {
        const desc = block.input?.description || block.input?.subagent_type || 'agent';
        hintParts.push(`⬡ ${desc.slice(0, 40)}`);
      } else if (block.name === 'Skill') {
        hintParts.push(`skill:${block.input?.skill || '?'}`);
      } else if (block.name.startsWith('mcp__')) {
        const parts = block.name.split('__');
        const server = (parts[1] || '').replace(/^claude_ai_/, '');
        const tool = (parts[2] || '').replace(/^[a-z]+-/, '');
        if (!hintParts.some(p => p.startsWith(`mcp:${server}`)))
          hintParts.push(`mcp:${server}/${tool}`);
      } else if (!['Read','Write','Edit','Bash','WebSearch','WebFetch','ToolSearch'].includes(block.name)) {
        hintParts.push(block.name);
      }
    }
    // Fallback to common tools if nothing notable
    if (!hintParts.length) {
      const common = msgToolNames.slice(0, 3);
      hintParts.push(...common);
      if (msgToolNames.length > 3) hintParts.push(`+${msgToolNames.length - 3}`);
    }
    toolHint = hintParts.slice(0, 3).join('  ');
    if (hintParts.length > 3) toolHint += `  +${hintParts.length - 3}`;
  }

  let bodyHtml = '';
  if (isUser) {
    if (typeof m.content === 'string') {
      bodyHtml = `<div class="msg-text">${escHtml(m.content)}</div>`;
    } else if (Array.isArray(m.content)) {
      const parts = [];
      for (const block of m.content) {
        if (!block) continue;
        if (block.type === 'tool_result') {
          const rc = Array.isArray(block.content) ? block.content.map(c => c.text || '').join('\n') : (block.content || '');
          const isError = block.is_error;
          parts.push(`<div class="tool-call" style="${isError ? 'border-color:var(--red)' : ''}">
            <div class="tool-name" style="color:${isError ? 'var(--red)' : 'var(--teal)'}">↩ result${isError ? ' (error)' : ''}</div>
            <div class="tool-input">${escHtml(rc.slice(0, 2000))}${rc.length > 2000 ? '\n…(truncated)' : ''}</div>
          </div>`);
        } else if (block.type === 'text') {
          parts.push(`<div class="msg-text">${escHtml(block.text)}</div>`);
        }
      }
      bodyHtml = parts.join('') || '<div class="msg-text" style="color:var(--text3)">(empty content)</div>';
    }
  } else {
    const content = Array.isArray(m.content) ? m.content : [];
    const parts = [];
    for (const block of content) {
      if (!block) continue;
      if (block.type === 'thinking') {
        parts.push(`<div class="thinking-block">🧠 <em>Thinking (${block.thinking ? block.thinking.length : 0} chars)</em></div>`);
      } else if (block.type === 'text') {
        parts.push(`<div class="msg-text">${escHtml(block.text)}</div>`);
      } else if (block.type === 'tool_use') {
        const inputStr = JSON.stringify(block.input || {}, null, 2);
        parts.push(`<div class="tool-call">
          <div class="tool-name">⚙ ${escHtml(block.name)}</div>
          <div class="tool-input">${escHtml(inputStr.slice(0, 1000))}${inputStr.length > 1000 ? '\n…' : ''}</div>
        </div>`);
      }
    }
    bodyHtml = parts.join('') || '<div class="msg-text" style="color:var(--text3)">(empty content)</div>';
  }

  let usageHtml = '';
  if (!isUser && m.usage) {
    const u = m.usage;
    usageHtml = `<div class="usage-inline">
      <span class="usage-chip">in: <span class="in">${fmt(u.input_tokens)}</span></span>
      <span class="usage-chip">out: <span class="out">${fmt(u.output_tokens)}</span></span>
      ${u.cache_creation_input_tokens ? `<span class="usage-chip">cache↑: <span class="cw">${fmt(u.cache_creation_input_tokens)}</span></span>` : ''}
      ${u.cache_read_input_tokens ? `<span class="usage-chip">cache↓: <span class="cr">${fmt(u.cache_read_input_tokens)}</span></span>` : ''}
      ${m.model ? `<span class="usage-chip" style="color:var(--accent)">${escHtml(modelShort(m.model))}</span>` : ''}
      ${mcpServers.map(s => `<span class="usage-chip"><span class="tag-mcp">mcp</span>${escHtml(s)}</span>`).join('')}
      ${skillsUsed.map(s => `<span class="usage-chip"><span class="tag-skill">skill</span>${escHtml(s)}</span>`).join('')}
      ${activeAgent?.kind === 'skill' && !skillsUsed.includes(activeAgent.name) ? `<span class="usage-chip"><span class="tag-skill">skill</span>${escHtml(activeAgent.name)}</span>` : ''}
      ${(state.agentSkillsByUuid?.[m.uuid] || []).filter(s => !skillsUsed.includes(s)).map(s => `<span class="usage-chip"><span class="tag-skill">skill</span>${escHtml(s)}</span>`).join('')}
    </div>`;
  }

  const ts = m.timestamp ? fmtTime(m.timestamp) : '';
  const msgId = `${pfx}msg-${i}`;

  let agentBadge = '';
  if (!isUser && activeAgent) {
    const icon = activeAgent.kind === 'skill' ? '⚡' : '⬡';
    const col = activeAgent.kind === 'skill' ? 'var(--purple)' : 'var(--teal)';
    agentBadge = `<span class="msg-agent-badge" style="color:${col}">${icon} ${escHtml(activeAgent.name)}</span>`;
  }

  return `
    <div class="message ${isAgent ? 'sidechain' : ''} ${collapseByDefault ? 'collapsed' : ''}" id="${msgId}" data-uuid="${escHtml(m.uuid || '')}">
      <div class="message-header" onclick="this.parentElement.classList.toggle('collapsed')">
        <span class="msg-role ${isUser ? 'user' : 'assistant'}">${isUser ? '👤 User' : '🤖 AI'}</span>
        ${agentBadge}
        ${isAgent ? '<span class="badge badge-sidechain">agent</span>' : ''}
        ${toolHint ? `<span class="msg-tool-hint">${escHtml(toolHint)}</span>` : ''}
        <div class="msg-meta">
          ${ts ? `<span>${ts}</span>` : ''}
          ${m.stopReason ? `<span style="color:var(--text3)">${escHtml(m.stopReason)}</span>` : ''}
        </div>
        <span class="msg-chevron">▼</span>
      </div>
      <div class="message-body">${bodyHtml}</div>
      ${usageHtml ? `<div class="message-stats">${usageHtml}</div>` : ''}
    </div>`;
}

/* ── Init ── */
document.querySelectorAll('.nav-item').forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    if (a.dataset.view === 'dashboard') loadDashboard();
  });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeAgentModal();
});

window.loadSessions = loadSessions;
window.loadSessionDetail = loadSessionDetail;
window.loadDashboard = loadDashboard;
window.setMsgFilter = setMsgFilter;
window.toggleTimeline = toggleTimeline;
window.closeAgentModal = closeAgentModal;

restoreFromUrl();
