/* ── State ── */
const state = {
  projects: null,
  stats: null,
  currentProject: null,
  currentSession: null,
  activityChart: null,
  msgFilter: 'all',
  timelineOpen: false,
};

/* ── Utils ── */
const $ = id => document.getElementById(id);
const fmt = n => n == null ? '—' : n.toLocaleString('fr-FR');
const fmtCost = v => v < 0.001 ? '<$0.001' : '$' + v.toFixed(v < 0.01 ? 4 : v < 0.1 ? 3 : 2);
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtTime = iso => iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';

function fmtRelative(iso) {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60) return 'à l\'instant';
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 7) return `il y a ${Math.floor(diff / 86400)}j`;
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
      <div class="subtitle">Analyse de l'ensemble de vos sessions Claude Code</div>
    </div>
    <div class="stats-grid">
      <div class="stat-card accent"><div class="label">Projets</div><div class="value">${fmt(projects.length)}</div></div>
      <div class="stat-card"><div class="label">Sessions</div><div class="value">${fmt(totalSessions)}</div></div>
      <div class="stat-card"><div class="label">Messages</div><div class="value">${fmt(totalMsgs)}</div></div>
      <div class="stat-card green"><div class="label">Coût estimé</div><div class="value">${fmtCost(totalCost)}</div></div>
      <div class="stat-card">
        <div class="label">Tokens input</div>
        <div class="value">${fmtMillions(totalInput)}</div>
        <div class="sub">+ ${fmtMillions(totalCacheR)} cache lus</div>
      </div>
      <div class="stat-card">
        <div class="label">Tokens output</div>
        <div class="value">${fmtMillions(totalOutput)}</div>
        <div class="sub">${fmtMillions(totalCacheW)} cache écrits</div>
      </div>
    </div>
    <div class="chart-section" style="margin-bottom:28px">
      <h2>Activité quotidienne</h2>
      <div class="chart-container"><canvas id="activity-chart"></canvas></div>
    </div>
    <div class="section-title" style="margin-bottom:12px">Projets <span style="font-weight:400;color:var(--text3)">(${projects.length})</span></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Projet</th><th>Chemin</th><th>Sessions</th><th>Messages</th><th>Input</th><th>Output</th><th>Coût</th><th>Dernière activité</th></tr></thead>
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
  const canvas = document.getElementById('activity-chart');
  if (!canvas) return;
  if (state.activityChart) { state.activityChart.destroy(); state.activityChart = null; }

  const daily = state.stats?.dailyActivity || [];
  if (!daily.length) return;

  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  state.activityChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: sorted.map(d => d.date.slice(5)),
      datasets: [
        { label: 'Messages', data: sorted.map(d => d.messageCount), backgroundColor: 'rgba(79,142,247,0.7)', borderRadius: 3 },
        { label: 'Tool calls', data: sorted.map(d => d.toolCallCount || 0), backgroundColor: 'rgba(167,139,250,0.6)', borderRadius: 3 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#8892a4', font: { size: 11 } } },
        tooltip: { backgroundColor: '#1a1e28', titleColor: '#e2e8f0', bodyColor: '#8892a4' },
      },
      scales: {
        x: { ticks: { color: '#5a6478', font: { size: 10 } }, grid: { color: '#1f2433' } },
        y: { ticks: { color: '#5a6478', font: { size: 10 } }, grid: { color: '#1f2433' } },
      },
    },
  });
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
      <div class="stat-card green"><div class="label">Coût total</div><div class="value">${fmtCost(project.totalCost)}</div></div>
      <div class="stat-card accent"><div class="label">Tokens input</div><div class="value">${fmtMillions(project.totalUsage.input)}</div></div>
    </div>
    <div class="section-title" style="margin-bottom:12px">Sessions</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Titre</th><th>Modèle</th><th>Messages</th><th>Agents</th><th>Input</th><th>Output</th><th>Coût</th><th>Date</th></tr></thead>
        <tbody>
          ${project.sessions.map(s => `
            <tr onclick="loadSessionDetail('${encodeURIComponent(dirName)}','${encodeURIComponent(s.file)}')">
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
async function loadSessionDetail(dirNameEncoded, fileEncoded) {
  const dirName = decodeURIComponent(dirNameEncoded);
  const file = decodeURIComponent(fileEncoded);
  pushUrl({ project: dirName, session: file });
  showView('session-detail');
  const container = $('view-session-detail');
  container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3)">Chargement...</div>';
  show(true);

  let session;
  try {
    session = await api(`/api/projects/${encodeURIComponent(dirName)}/sessions/${encodeURIComponent(file)}`);
  } catch (e) {
    container.innerHTML = `<div style="padding:40px;color:var(--red)">Erreur: ${escHtml(e.message)}</div>`;
    show(false);
    return;
  }
  show(false);
  state.currentSession = { session, dirName, file };
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
      <div class="meta-item"><div class="meta-label">Modèle</div><div class="meta-value accent">${escHtml(modelShort(model))}</div></div>
      <div class="meta-item"><div class="meta-label">Début</div><div class="meta-value">${fmtDate(firstTimestamp)} ${fmtTime(firstTimestamp)}</div></div>
      <div class="meta-item"><div class="meta-label">Durée</div><div class="meta-value">${durationMs != null ? fmtDuration(durationMs) : '—'}</div></div>
      <div class="meta-item"><div class="meta-label">Messages</div><div class="meta-value">${fmt(session.messageCount)}</div></div>
      ${hasAgents ? `<div class="meta-item"><div class="meta-label">Agents</div><div class="meta-value" style="color:var(--purple)">${fmt(agents.length)}</div></div>` : ''}
      ${cwd ? `<div class="meta-item"><div class="meta-label">Répertoire</div><div class="meta-value mono">${escHtml(cwd.replace('/home/olivier-j/', '~/'))}</div></div>` : ''}
      ${gitBranch && gitBranch !== 'HEAD' ? `<div class="meta-item"><div class="meta-label">Branche</div><div class="meta-value mono" style="color:var(--green)">${escHtml(gitBranch)}</div></div>` : ''}
    </div>
    ${mcpBar}${skillBar}

    <div class="token-bar">
      <div class="token-item"><div class="token-label">Input</div><div class="token-value input">${fmt(totalUsage.input)}</div></div>
      <div class="token-item"><div class="token-label">Output</div><div class="token-value output">${fmt(totalUsage.output)}</div></div>
      <div class="token-item"><div class="token-label">Cache écrit</div><div class="token-value cache-w">${fmt(totalUsage.cache_write)}</div></div>
      <div class="token-item"><div class="token-label">Cache lu</div><div class="token-value cache-r">${fmt(totalUsage.cache_read)}</div></div>
      <div class="token-item" style="margin-left:auto"><div class="token-label">Coût estimé</div><div class="token-value cost">${fmtCost(totalCost)}</div></div>
    </div>

    <!-- Timeline toggle -->
    <div class="timeline-toggle${state.timelineOpen ? ' open' : ''}" onclick="toggleTimeline('${escHtml(dirName)}', '${escHtml(file)}')">
      <span class="tl-icon">⬡</span>
      <span>Timeline${hasAgents ? ` — ${agents.length} agent${agents.length > 1 ? 's' : ''}` : ''}</span>
      <span id="tl-chevron" style="margin-left:auto;font-size:10px;transition:transform 0.2s">${state.timelineOpen ? '▲' : '▼'}</span>
    </div>
    <div id="timeline-section" style="display:${state.timelineOpen ? 'block' : 'none'}">
      <div id="timeline-content" class="timeline-wrap">
        ${buildGanttSVG(session)}
      </div>
      <div id="timeline-detail" class="tl-detail hidden"></div>
    </div>

    ${hasAgents || subAgentMessages > 0 ? `
    <div class="filter-bar">
      <span style="font-size:12px;color:var(--text3)">Messages :</span>
      <button class="filter-btn active" data-filter="all" onclick="setMsgFilter('all','${encodeURIComponent(dirName)}','${encodeURIComponent(file)}')">Tous (${fmt(session.messageCount)})</button>
      <button class="filter-btn" data-filter="main" onclick="setMsgFilter('main','${encodeURIComponent(dirName)}','${encodeURIComponent(file)}')">Thread principal (${fmt(mainAgentMessages)})</button>
    </div>` : ''}

    <div id="messages-list" class="messages-container">
      ${renderMessages(session.messages)}
    </div>`;

  initGanttEvents(session, dirName, file);
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
}

const AGENT_COLORS = ['#a78bfa', '#2dd4bf', '#34d399', '#f97316', '#60a5fa', '#f87171', '#fbbf24', '#c084fc', '#38bdf8', '#4ade80'];

function buildGanttSVG(session) {
  const { messages, agents } = session;
  const timeMsgs = messages.filter(m => m.timestamp && (m.type === 'user' || m.type === 'assistant'));
  if (timeMsgs.length === 0) return '<div style="padding:20px;color:var(--text3);text-align:center">Pas de données temporelles</div>';

  const hasAgents = agents && agents.length > 0;

  // Time bounds
  let tMin = Math.min(...timeMsgs.map(m => new Date(m.timestamp).getTime()));
  let tMax = Math.max(...timeMsgs.map(m => new Date(m.timestamp).getTime()));
  if (hasAgents) {
    for (const a of agents) {
      if (a.firstTimestamp) tMin = Math.min(tMin, new Date(a.firstTimestamp).getTime());
      if (a.lastTimestamp) tMax = Math.max(tMax, new Date(a.lastTimestamp).getTime());
    }
  }
  tMax += Math.max(5000, (tMax - tMin) * 0.02);
  const totalMs = tMax - tMin;
  if (totalMs <= 0) return '<div style="padding:20px;color:var(--text3);text-align:center">Session instantanée</div>';

  // SVG layout
  const SVG_W = 1000;
  const LABEL_W = 150;
  const PAD_R = 16;
  const CHART_W = SVG_W - LABEL_W - PAD_R;
  const USER_H = 24;
  const MAIN_H = 48;
  const AGENT_H = 30;
  const AXIS_H = 26;
  const GAP = 6;

  const numAgents = hasAgents ? agents.length : 0;
  const SVG_H = 10 + USER_H + GAP + MAIN_H + (numAgents > 0 ? GAP + numAgents * (AGENT_H + 3) : 0) + AXIS_H;

  const toX = ms => LABEL_W + ((ms - tMin) / totalMs) * CHART_W;

  let parts = [];
  let currentY = 10;

  // ── Grid lines ──
  const numTicks = 8;
  for (let i = 0; i <= numTicks; i++) {
    const x = LABEL_W + (i / numTicks) * CHART_W;
    parts.push(`<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${SVG_H - AXIS_H}" stroke="#1a1e28" stroke-width="1"/>`);
  }

  // ── User track ──
  const userMsgs = timeMsgs.filter(m => m.type === 'user');
  parts.push(`<text x="${LABEL_W - 8}" y="${currentY + USER_H / 2 + 4}" text-anchor="end" fill="#5a6478" font-size="10" font-family="system-ui">👤 User</text>`);
  for (const m of userMsgs) {
    const x = toX(new Date(m.timestamp).getTime());
    parts.push(`<rect x="${x - 1.5}" y="${currentY + 2}" width="3" height="${USER_H - 4}" fill="#fbbf24" rx="1" opacity="0.9" class="gantt-msg" data-uuid="${escHtml(m.uuid || '')}"/>`);
  }
  currentY += USER_H + GAP;

  // ── Main AI track ──
  const assistMsgs = timeMsgs.filter(m => m.type === 'assistant');
  parts.push(`<text x="${LABEL_W - 8}" y="${currentY + MAIN_H / 2 + 4}" text-anchor="end" fill="#8892a4" font-size="11" font-family="system-ui">🤖 Main AI</text>`);
  parts.push(`<rect x="${LABEL_W}" y="${currentY}" width="${CHART_W}" height="${MAIN_H}" fill="#4f8ef710" rx="3"/>`);

  for (let i = 0; i < assistMsgs.length; i++) {
    const m = assistMsgs[i];
    const nextM = assistMsgs[i + 1];
    const startMs = new Date(m.timestamp).getTime();
    const endMs = nextM
      ? new Date(nextM.timestamp).getTime()
      : Math.min(startMs + 30000, tMin + totalMs);
    const x = toX(startMs);
    const w = Math.max(4, toX(endMs) - x - 1);
    const barY = currentY + 8;
    const barH = MAIN_H - 16;

    const content = Array.isArray(m.content) ? m.content : [];
    const tools = content.filter(c => c && c.type === 'tool_use');
    const hasAgentTool = tools.some(t => t.name === 'Agent');
    const color = hasAgentTool ? '#a78bfa' : '#4f8ef7';

    parts.push(`<rect x="${x.toFixed(1)}" y="${barY}" width="${w.toFixed(1)}" height="${barH}" fill="${color}" rx="2" opacity="0.85" class="gantt-msg" data-uuid="${escHtml(m.uuid || '')}">
      <title>${escHtml(tools.map(t => t.name).join(', ') || 'Réponse')}</title>
    </rect>`);

    if (w > 50 && tools.length > 0) {
      const label = tools.slice(0, 2).map(t => t.name.replace(/([A-Z])/g, ' $1').trim()).join(', ');
      parts.push(`<text x="${(x + 4).toFixed(1)}" y="${barY + barH - 4}" fill="white" font-size="8" opacity="0.85" pointer-events="none">${escHtml(label.slice(0, Math.floor(w / 6)))}</text>`);
    }
  }
  currentY += MAIN_H + GAP;

  // ── Agent tracks ──
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    const color = AGENT_COLORS[i % AGENT_COLORS.length];
    const y = currentY + i * (AGENT_H + 3);
    const cy = y + AGENT_H / 2;

    const label = (agent.meta?.description || agent.agentId || '').slice(0, 22);
    parts.push(`<text x="${LABEL_W - 8}" y="${cy + 4}" text-anchor="end" fill="#5a6478" font-size="9.5" font-family="system-ui">${escHtml(label)}</text>`);

    // Track bg
    parts.push(`<rect x="${LABEL_W}" y="${y}" width="${CHART_W}" height="${AGENT_H}" fill="${color}08" rx="2"/>`);

    if (agent.firstTimestamp && agent.lastTimestamp) {
      const startMs = new Date(agent.firstTimestamp).getTime();
      const endMs = new Date(agent.lastTimestamp).getTime();
      const x = toX(startMs);
      const w = Math.max(6, toX(endMs) - x);
      const barY = y + 5;
      const barH = AGENT_H - 10;

      // Spawn connector
      if (agent.spawnedAt) {
        const spawnX = toX(new Date(agent.spawnedAt).getTime());
        const mainBottomY = 10 + USER_H + GAP + MAIN_H;
        parts.push(`<line x1="${spawnX.toFixed(1)}" y1="${mainBottomY}" x2="${x.toFixed(1)}" y2="${cy.toFixed(1)}" stroke="${color}" stroke-width="1" stroke-dasharray="4,3" opacity="0.35"/>`);
      }

      const depth = agent.meta?.spawnDepth || 1;
      const depthBorder = depth > 1 ? ` stroke="${color}" stroke-width="1.5"` : '';

      parts.push(`<rect x="${x.toFixed(1)}" y="${barY}" width="${w.toFixed(1)}" height="${barH}" fill="${color}" rx="2" opacity="0.8" class="gantt-agent" data-agent-id="${escHtml(agent.agentId)}"${depthBorder} style="cursor:pointer">
        <title>${escHtml(agent.meta?.description || agent.agentId)} | ${agent.messageCount} msgs | ${fmtCost(agent.totalCost)} | ${fmtDuration(endMs - startMs)}</title>
      </rect>`);

      if (w > 40) {
        const info = `${fmtCost(agent.totalCost)} · ${agent.messageCount}msg`;
        parts.push(`<text x="${(x + 4).toFixed(1)}" y="${barY + barH - 4}" fill="white" font-size="8" opacity="0.9" pointer-events="none">${escHtml(info.slice(0, Math.floor(w / 5)))}</text>`);
      }
    }
  }

  if (numAgents > 0) currentY += numAgents * (AGENT_H + 3) + GAP;

  // ── Time axis ──
  const axisY = SVG_H - AXIS_H + 2;
  parts.push(`<line x1="${LABEL_W}" y1="${axisY}" x2="${SVG_W - PAD_R}" y2="${axisY}" stroke="#252b3a" stroke-width="1"/>`);
  for (let i = 0; i <= numTicks; i++) {
    const frac = i / numTicks;
    const x = LABEL_W + frac * CHART_W;
    const label = fmtDuration(frac * totalMs);
    parts.push(`<line x1="${x.toFixed(1)}" y1="${axisY}" x2="${x.toFixed(1)}" y2="${axisY + 4}" stroke="#2e3650"/>`);
    parts.push(`<text x="${x.toFixed(1)}" y="${axisY + 15}" text-anchor="middle" fill="#5a6478" font-size="9" font-family="system-ui">${label}</text>`);
  }

  return `
    <div class="gantt-svg-wrap">
      <svg id="gantt-svg" viewBox="0 0 ${SVG_W} ${SVG_H}" preserveAspectRatio="none" style="width:100%;height:${SVG_H}px;display:block" xmlns="http://www.w3.org/2000/svg">
        ${parts.join('\n')}
      </svg>
    </div>
    <div id="gantt-tip" class="gantt-tooltip hidden"></div>`;
}

function initGanttEvents(session, dirName, file) {
  const svg = $('gantt-svg');
  const tip = $('gantt-tip');
  if (!svg || !tip) return;

  svg.addEventListener('mousemove', e => {
    const target = e.target.closest('[data-uuid],[data-agent-id]');
    if (!target) { tip.classList.add('hidden'); return; }

    if (target.dataset.uuid) {
      const msg = session.messages.find(m => m.uuid === target.dataset.uuid);
      if (msg) {
        const ts = msg.timestamp ? fmtTime(msg.timestamp) : '';
        const tools = Array.isArray(msg.content) ? msg.content.filter(c => c && c.type === 'tool_use') : [];
        const toolStr = tools.map(t => t.name).join(', ');
        tip.innerHTML = `<strong>${msg.type === 'user' ? 'User' : 'Assistant'}</strong> ${ts}${toolStr ? `<br><span style="color:var(--purple)">${escHtml(toolStr)}</span>` : ''}${msg.usage ? `<br>in:${fmt(msg.usage.input_tokens)} out:${fmt(msg.usage.output_tokens)}` : ''}`;
      }
    } else if (target.dataset.agentId) {
      const agent = session.agents.find(a => a.agentId === target.dataset.agentId);
      if (agent) {
        const dur = agent.firstTimestamp && agent.lastTimestamp
          ? fmtDuration(new Date(agent.lastTimestamp) - new Date(agent.firstTimestamp)) : '?';
        tip.innerHTML = `<strong>${escHtml(agent.meta?.description || agent.agentId)}</strong><br>${agent.messageCount} msgs · ${fmtCost(agent.totalCost)} · ${dur}`;
      }
    }

    // Tooltip fixed to viewport — avoids any container clip issues
    tip.classList.remove('hidden');
    tip.style.left = (e.clientX + 14) + 'px';
    tip.style.top = (e.clientY - 10) + 'px';
  });

  svg.addEventListener('mouseleave', () => tip.classList.add('hidden'));

  // Click → show inline detail panel below the timeline
  svg.addEventListener('click', async e => {
    const bar = e.target.closest('[data-agent-id],[data-uuid]');
    if (!bar) return;
    tip.classList.add('hidden');

    if (bar.dataset.agentId) {
      showTimelineAgentDetail(session, dirName, file, bar.dataset.agentId);
    } else if (bar.dataset.uuid) {
      showTimelineMessageDetail(session, bar.dataset.uuid);
    }
  });
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
          <div class="tool-name" style="color:${tr.is_error ? 'var(--red)' : 'var(--teal)'}">↩ résultat${tr.is_error ? ' (erreur)' : ''}</div>
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
    <div class="tl-detail-body">${body || '<span style="color:var(--text3)">Contenu vide</span>'}</div>`;
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
        <div style="text-align:center;color:var(--text3);padding:40px">Chargement…</div>
      </div>
    </div>`;
  modal.style.display = 'flex';

  try {
    const detail = await api(`/api/projects/${encodeURIComponent(dirName)}/sessions/${encodeURIComponent(file)}/agents/${encodeURIComponent(agentId)}`);
    $('agent-modal-body').className = 'agent-modal-body';
    $('agent-modal-body').innerHTML = `
      <div class="agent-modal-stats">
        <div class="token-item"><div class="token-label">Input</div><div class="token-value input">${fmt(detail.totalUsage.input)}</div></div>
        <div class="token-item"><div class="token-label">Output</div><div class="token-value output">${fmt(detail.totalUsage.output)}</div></div>
        <div class="token-item"><div class="token-label">Cache lu</div><div class="token-value cache-r">${fmt(detail.totalUsage.cache_read)}</div></div>
        <div class="token-item" style="margin-left:auto"><div class="token-label">Coût</div><div class="token-value cost">${fmtCost(detail.totalCost)}</div></div>
      </div>
      <div class="agent-modal-messages">
        ${renderAgentMessages(detail.messages)}
      </div>`;
  } catch (e) {
    $('agent-modal-body').innerHTML = `<div style="color:var(--red);padding:20px">Erreur : ${escHtml(e.message)}</div>`;
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
      <div class="token-item"><div class="token-label">Durée</div><div class="token-value" style="color:var(--text2)">${dur}</div></div>
      <div class="token-item" style="margin-left:auto"><div class="token-label">Coût</div><div class="token-value cost">${fmtCost(detail.totalCost)}</div></div>
    </div>

    ${taskText ? `
    <div class="agent-section">
      <div class="agent-section-label">📋 Tâche</div>
      <div class="agent-task-text">${escHtml(taskText.slice(0, 600))}${taskText.length > 600 ? '…' : ''}</div>
    </div>` : ''}

    <div class="agent-section">
      <div class="agent-section-label">⚙ Outils utilisés — ${toolCalls.length} appels</div>
      <div class="tool-summary-chips">
        ${Object.entries(toolCount).sort((a,b) => b[1]-a[1]).map(([name, count]) =>
          `<span class="tool-chip">${escHtml(name)}<span class="tool-chip-count">${count}</span></span>`
        ).join('')}
      </div>
    </div>

    <div class="agent-section">
      <div class="agent-section-label">📜 Séquence des appels</div>
      <div class="tool-sequence">
        ${toolCalls.slice(0, 60).map((t, i) => {
          const inputPreview = getToolInputPreview(t.name, t.input);
          return `<div class="tool-seq-item">
            <span class="tool-seq-num">${i + 1}</span>
            <span class="tool-seq-name">${escHtml(t.name)}</span>
            ${inputPreview ? `<span class="tool-seq-preview">${escHtml(inputPreview)}</span>` : ''}
          </div>`;
        }).join('')}
        ${toolCalls.length > 60 ? `<div style="color:var(--text3);font-size:11px;padding:4px 0">… et ${toolCalls.length - 60} autres appels</div>` : ''}
      </div>
    </div>

    ${finalText ? `
    <div class="agent-section">
      <div class="agent-section-label">✅ Résultat final</div>
      <div class="agent-result-text">${escHtml(finalText.slice(0, 1200))}${finalText.length > 1200 ? '…' : ''}</div>
    </div>` : ''}

    <div style="padding:12px 0 4px">
      <button class="filter-btn" onclick="showAllAgentMessages(${JSON.stringify(detail.messages.length)})" style="font-size:12px">
        Voir tous les messages (${detail.messages.length})
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
        bodyParts.push(`<div style="color:var(--text3);font-size:12px">↩ ${content.length} résultat(s) d'outils</div>`);
      } else {
        const text = extractText(m.content);
        if (text) bodyParts.push(`<div class="msg-text">${escHtml(text.slice(0, 500))}</div>`);
      }
    } else {
      for (const block of content) {
        if (!block) continue;
        if (block.type === 'thinking') {
          bodyParts.push(`<div class="thinking-block">🧠 réflexion (${block.thinking?.length || 0} chars)</div>`);
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
        <div class="message-body" style="padding:10px 12px">${bodyParts.join('') || '<div style="color:var(--text3);font-size:11px">vide</div>'}</div>
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
  if (!filtered.length) return '<div class="empty"><p>Aucun message</p></div>';

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
            <div class="tool-name" style="color:${isError ? 'var(--red)' : 'var(--teal)'}">↩ résultat${isError ? ' (erreur)' : ''}</div>
            <div class="tool-input">${escHtml(rc.slice(0, 2000))}${rc.length > 2000 ? '\n…(tronqué)' : ''}</div>
          </div>`);
        } else if (block.type === 'text') {
          parts.push(`<div class="msg-text">${escHtml(block.text)}</div>`);
        }
      }
      bodyHtml = parts.join('') || '<div class="msg-text" style="color:var(--text3)">(contenu vide)</div>';
    }
  } else {
    const content = Array.isArray(m.content) ? m.content : [];
    const parts = [];
    for (const block of content) {
      if (!block) continue;
      if (block.type === 'thinking') {
        parts.push(`<div class="thinking-block">🧠 <em>Réflexion (${block.thinking ? block.thinking.length : 0} chars)</em></div>`);
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
    bodyHtml = parts.join('') || '<div class="msg-text" style="color:var(--text3)">(contenu vide)</div>';
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
