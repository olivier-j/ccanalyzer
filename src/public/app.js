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
  toolUsage: null,
  toolUsagePromise: null,
  toolsFilter: 'all',
  toolsMergeNs: false,
  usageCharts: {},
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

/* ── Sortable tables ── */
// Data-driven table with clickable headers. columns: [{ label, render(row), sort(row), asc }].
// `sort` returns the raw comparable value (number/string); `asc` makes the first
// click sort ascending (default for text columns) instead of descending.
// Clicking the active header flips direction. Null/undefined values sort last.
// opts.pageSize (+ opts.pagerEl) paginate long lists: the full list is sorted,
// then sliced to a page, and a soft pager is drawn into pagerEl. Sorting resets
// to page 1. Omit opts.pageSize for an un-paginated table (dashboard/sessions).
function mountSortableTable(el, rows, columns, rowAttrs, opts = {}) {
  const pageSize = opts.pageSize || 0;
  const pagerEl = opts.pagerEl || null;
  // Paginate only when there is a pager to navigate with — a missing pager slot
  // must not silently hide rows past the first page.
  const paginate = pageSize > 0 && !!pagerEl;
  const st = { col: null, dir: -1, page: 0 };

  const compare = (a, b) => {
    const va = columns[st.col].sort(a);
    const vb = columns[st.col].sort(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    const c = typeof va === 'number' && typeof vb === 'number'
      ? va - vb : String(va).localeCompare(String(vb));
    return c * st.dir;
  };

  function renderPager(total) {
    if (!pagerEl) return;
    if (total <= pageSize) { pagerEl.innerHTML = ''; return; }
    const pages = Math.ceil(total / pageSize);
    const from = st.page * pageSize + 1;
    const to = Math.min(total, from + pageSize - 1);
    pagerEl.innerHTML =
      `<button class="pager-btn" data-d="-1"${st.page === 0 ? ' disabled' : ''}>‹</button>` +
      `<span class="pager-range">${from}–${to} / ${total}</span>` +
      `<button class="pager-btn" data-d="1"${st.page >= pages - 1 ? ' disabled' : ''}>›</button>`;
    pagerEl.querySelectorAll('.pager-btn').forEach(btn => btn.addEventListener('click', () => {
      st.page += +btn.dataset.d;
      draw();
    }));
  }

  function draw() {
    const ordered = st.col == null ? rows : [...rows].sort(compare);
    let slice = ordered;
    if (paginate) {
      const pages = Math.max(1, Math.ceil(ordered.length / pageSize));
      st.page = Math.min(Math.max(st.page, 0), pages - 1);
      slice = ordered.slice(st.page * pageSize, st.page * pageSize + pageSize);
    }
    const head = columns.map((c, i) => {
      const active = st.col === i;
      const arrow = active ? (st.dir === 1 ? '▲' : '▼') : '';
      return `<th class="sortable${active ? ' sorted' : ''}" data-col="${i}">${escHtml(c.label)}<span class="sort-arrow">${arrow}</span></th>`;
    }).join('');
    const body = slice.map(r =>
      `<tr${rowAttrs ? ' ' + rowAttrs(r) : ''}>${columns.map(c => c.render(r)).join('')}</tr>`
    ).join('');
    el.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    el.querySelectorAll('th.sortable').forEach(th => th.addEventListener('click', () => {
      const i = +th.dataset.col;
      if (st.col === i) st.dir = -st.dir;
      else { st.col = i; st.dir = columns[i].asc ? 1 : -1; }
      st.page = 0;
      draw();
    }));
    if (paginate) renderPager(ordered.length);
  }
  draw();
}

/* ── Navigation ── */
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $('view-' + name).classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(a => {
    a.classList.toggle('active', a.dataset.view === name || a.dataset.view === name.split('-')[0]);
  });
  // A chart mounted while its view was hidden inits at width 0; resize now-visible ones.
  for (const arr of Object.values(state.usageCharts || {})) {
    for (const c of arr) { try { if (c.getDom()?.offsetParent) c.resize(); } catch {} }
  }
}

function pushUrl(params) {
  const qs = new URLSearchParams(params).toString();
  history.pushState(params, '', qs ? '?' + qs : location.pathname);
}

function restoreFromUrl() {
  const p = new URLSearchParams(location.search);
  const view = p.get('view');
  const project = p.get('project');
  const session = p.get('session');
  if (view === 'tools') return loadToolUsage();
  if (project && session) return loadSessionDetail(encodeURIComponent(project), encodeURIComponent(session));
  if (project) return loadSessions(encodeURIComponent(project));
  loadDashboard();
}

window.addEventListener('popstate', e => {
  const d = e.state || {};
  if (d.view === 'tools') loadToolUsage();
  else if (d.session && d.project) loadSessionDetail(encodeURIComponent(d.project), encodeURIComponent(d.session));
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
    <div class="table-wrap" id="projects-table"></div>`;

  const projectColumns = [
    { label: 'Project', asc: true, sort: p => p.name?.toLowerCase(), render: p => `<td class="td-name">${escHtml(p.name)}</td>` },
    { label: 'Path', asc: true, sort: p => p.path?.toLowerCase(), render: p => `<td class="td-path" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(p.path)}</td>` },
    { label: 'Sessions', sort: p => p.sessionCount, render: p => `<td class="td-num">${fmt(p.sessionCount)}</td>` },
    { label: 'Messages', sort: p => p.totalMessages, render: p => `<td class="td-num">${fmt(p.totalMessages)}</td>` },
    { label: 'Input', sort: p => p.totalUsage.input, render: p => `<td class="td-num" style="color:var(--accent)">${fmtMillions(p.totalUsage.input)}</td>` },
    { label: 'Output', sort: p => p.totalUsage.output, render: p => `<td class="td-num" style="color:var(--green)">${fmtMillions(p.totalUsage.output)}</td>` },
    { label: 'Cost', sort: p => p.totalCost, render: p => `<td class="td-cost">${fmtCost(p.totalCost)}</td>` },
    { label: 'Last activity', sort: p => p.lastActivity ? new Date(p.lastActivity).getTime() : null, render: p => `<td class="td-date">${fmtRelative(p.lastActivity)}</td>` },
  ];
  mountSortableTable($('projects-table'), projects, projectColumns,
    p => `onclick="loadSessions('${encodeURIComponent(p.dirName)}')"`);

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

/* ── Tool usage ── */
// Load /api/tool-usage once, sharing a single in-flight request across concurrent
// callers (tools view + per-project panels) so rapid navigation can't fan out
// into duplicate multi-second scans. Retries after a failure (promise cleared).
function fetchToolUsage() {
  if (state.toolUsage) return Promise.resolve(state.toolUsage);
  if (!state.toolUsagePromise) {
    state.toolUsagePromise = api('/api/tool-usage')
      .then(u => { state.toolUsage = u.projects || []; return state.toolUsage; })
      .finally(() => { state.toolUsagePromise = null; });
  }
  return state.toolUsagePromise;
}

async function loadToolUsage() {
  pushUrl({ view: 'tools' });
  showView('tools');
  setBreadcrumb(['Tool usage']);

  if (!state.toolUsage) {
    show(true);
    try {
      await Promise.all([
        fetchToolUsage(),
        state.projects ? Promise.resolve() : api('/api/projects').then(p => { state.projects = p; }),
      ]);
    } catch (e) {
      $('view-tools').innerHTML = `<div style="padding:40px;color:var(--red)">Error: ${escHtml(e.message)}</div>`;
      return;
    } finally { show(false); }
  }
  renderToolUsage();
}

function setToolsFilter(dirName) {
  state.toolsFilter = dirName || 'all';
  renderToolUsage();
}

function setToolsMergeNs(on) {
  state.toolsMergeNs = !!on;
  renderToolUsage();
}

// Merge per-project usage buckets into one; used for the "All projects" view.
function mergeToolBuckets(list) {
  const acc = { tools: {}, skills: {}, mcpServers: {}, mcpTools: {}, agents: {}, totalCalls: 0 };
  for (const b of list) {
    for (const key of ['tools', 'skills', 'mcpServers', 'mcpTools', 'agents']) {
      for (const [k, v] of Object.entries(b[key] || {})) acc[key][k] = (acc[key][k] || 0) + v;
    }
    acc.totalCalls += b.totalCalls || 0;
  }
  return acc;
}

const rankUsage = obj => Object.entries(obj).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
const sumUsage = obj => Object.values(obj).reduce((s, v) => s + v, 0);

// Collapse "namespace:name" keys into "name" (e.g. babs:smart-commit → smart-commit),
// summing counts. Used to merge the same skill/agent installed under several
// namespaces. MCP names use "__" separators so they're unaffected.
function collapseNamespaces(counts) {
  const out = {};
  for (const [k, v] of Object.entries(counts)) {
    const key = k.replace(/^[\w.-]+:/, '');
    out[key] = (out[key] || 0) + v;
  }
  return out;
}

// A copy of the bucket with skill and subagent names merged across namespaces.
function mergeNamespaces(b) {
  return { ...b, skills: collapseNamespaces(b.skills), agents: collapseNamespaces(b.agents) };
}

// MCP tool rows with a readable "server / tool" name (e.g. "Atlassian / getJiraIssue").
function mcpToolRows(b) {
  return rankUsage(b.mcpTools).map(r => {
    const parts = r.name.split('__');
    const server = (parts[1] || '').replace(/^claude_ai_/, '');
    return { name: `${server} / ${parts.slice(2).join('__')}`, count: r.count };
  });
}

// Count tool_use blocks from a message list into a fresh bucket — client-side
// equivalent of parser.js countToolsInFile, used for the single-conversation
// breakdown (which only has the main thread loaded, no subagent tool calls).
function bucketFromMessages(messages) {
  const b = { tools: {}, skills: {}, mcpServers: {}, mcpTools: {}, agents: {}, totalCalls: 0 };
  for (const m of (messages || [])) {
    if (m.type !== 'assistant') continue;
    for (const block of (Array.isArray(m.content) ? m.content : [])) {
      if (!block || block.type !== 'tool_use' || !block.name) continue;
      b.totalCalls++;
      const name = block.name;
      if (name.startsWith('mcp__')) {
        const parts = name.split('__');
        const server = (parts[1] || '').replace(/^claude_ai_/, '').replace(/_/g, ' ') || '(unknown)';
        b.mcpServers[server] = (b.mcpServers[server] || 0) + 1;
        b.mcpTools[name] = (b.mcpTools[name] || 0) + 1;
      } else if (name === 'Skill') {
        const s = block.input?.skill || '(unknown)';
        b.skills[s] = (b.skills[s] || 0) + 1;
      } else {
        b.tools[name] = (b.tools[name] || 0) + 1;
      }
    }
  }
  return b;
}

// One usage-table block: title + soft-pager slot (filled by mountUsageTable) + the table container.
function usageTableBlock(title, tblId) {
  return `<div>
    <div class="usage-tbl-head"><span class="section-title">${escHtml(title)}</span><span class="usage-pager" id="${tblId}-pager"></span></div>
    <div class="table-wrap table-static" id="${tblId}"></div>
  </div>`;
}

// Two-column count table (Name / Calls), pre-ranked descending, sortable, and
// paginated (10/page) with a soft pager in the `${elId}-pager` slot next to the title.
function mountUsageTable(elId, rows, nameLabel, countLabel) {
  const el = $(elId);
  if (!el) return;
  if (!rows.length) { el.innerHTML = `<div class="usage-loading">No data</div>`; return; }
  mountSortableTable(el, rows, [
    { label: nameLabel, asc: true, sort: r => r.name.toLowerCase(), render: r => `<td class="td-name" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(r.name)}</td>` },
    { label: countLabel, sort: r => r.count, render: r => `<td class="td-num">${fmt(r.count)}</td>` },
  ], null, { pageSize: 10, pagerEl: document.getElementById(`${elId}-pager`) });
}

// Category → colour for the unified Top-N chart, legend, and per-bar colouring.
const USAGE_CATEGORIES = [
  { key: 'internal', label: 'Internal', color: '#4f8ef7', get: b => b.tools },
  { key: 'skills', label: 'Skills', color: '#a78bfa', get: b => b.skills },
  { key: 'mcp', label: 'MCP', color: '#2dd4bf', get: b => b.mcpServers },
  { key: 'agents', label: 'Agents', color: '#34d399', get: b => b.agents },
];

// Build the item list for a chart: the top `limit` entries of one category, each
// tagged with its category colour for renderTopChart. Callers pass a single
// category ('internal'/'skills'/'mcp'); cat='all' would pool every category and
// `showAgents` gates the agents category — both kept general but unused by the
// current one-chart-per-category layout.
function combinedUsageItems(b, cat, showAgents, limit = 20) {
  const items = [];
  for (const c of USAGE_CATEGORIES) {
    if (c.key === 'agents' && !showAgents) continue;
    if (cat !== 'all' && cat !== c.key) continue;
    for (const [name, count] of Object.entries(c.get(b))) {
      items.push({ name, count, color: c.color, cat: c.label });
    }
  }
  items.sort((a, b) => b.count - a.count);
  return items.slice(0, limit);
}

// Usage-breakdown component (stat cards + unified chart + sortable tables), shared
// by the global Tool-usage view, the per-project view, and a single conversation.
// `prefix` namespaces element ids so several breakdowns can coexist on a page.
// `opts.category` filters both the chart and tables; `opts.showAgents` (default
// true) hides subagents when the caller has none (single conversation).
function usageBreakdownHtml(b, prefix, opts = {}) {
  const toolRows = rankUsage(b.tools);
  const skillRows = rankUsage(b.skills);
  const serverRows = rankUsage(b.mcpServers);
  const agentRows = rankUsage(b.agents);
  const showAgents = opts.showAgents !== false;

  const chartH = rows => Math.max(120, Math.min(rows.length, 12) * 26 + 24);
  const chart = (title, id, rows) => rows.length
    ? `<div class="chart-section" style="margin-bottom:20px"><h2>${title}</h2><div id="${id}" style="height:${chartH(rows)}px"></div></div>`
    : '';

  return `
    <div class="stats-grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">
      <div class="stat-card accent"><div class="label">Total tool calls</div><div class="value">${fmt(b.totalCalls)}</div></div>
      <div class="stat-card"><div class="label">Built-in tools</div><div class="value">${fmt(sumUsage(b.tools))}</div><div class="sub">${toolRows.length} distinct</div></div>
      <div class="stat-card purple"><div class="label">Skill invocations</div><div class="value">${fmt(sumUsage(b.skills))}</div><div class="sub">${skillRows.length} distinct</div></div>
      <div class="stat-card"><div class="label">MCP calls</div><div class="value">${fmt(sumUsage(b.mcpServers))}</div><div class="sub">${serverRows.length} servers</div></div>
      ${showAgents ? `<div class="stat-card green"><div class="label">Agents spawned</div><div class="value">${fmt(sumUsage(b.agents))}</div><div class="sub">${agentRows.length} types</div></div>` : ''}
    </div>

    ${chart('Top tools', `${prefix}-tools-chart`, toolRows)}
    ${chart('Top skills', `${prefix}-skills-chart`, skillRows)}
    ${chart('Top MCP servers', `${prefix}-mcp-chart`, serverRows)}

    <div class="tools-tables">
      ${usageTableBlock('Built-in tools', `${prefix}-tbl-tools`)}
      ${usageTableBlock('Skills', `${prefix}-tbl-skills`)}
      ${usageTableBlock('MCP servers', `${prefix}-tbl-mcp`)}
      ${usageTableBlock('MCP tools', `${prefix}-tbl-mcptools`)}
      ${showAgents ? usageTableBlock('Subagent types', `${prefix}-tbl-agents`) : ''}
    </div>`;
}

// Charts/tables self-skip when their target div is absent, so this can attempt
// every section unconditionally. Each chart is a single category → single colour.
function mountUsageBreakdown(b, prefix, opts = {}) {
  const showAgents = opts.showAgents !== false;
  (state.usageCharts[prefix] || []).forEach(c => c.dispose());
  const charts = state.usageCharts[prefix] = [];

  renderTopChart(`${prefix}-tools-chart`, combinedUsageItems(b, 'internal', showAgents, 12), charts);
  renderTopChart(`${prefix}-skills-chart`, combinedUsageItems(b, 'skills', showAgents, 12), charts);
  renderTopChart(`${prefix}-mcp-chart`, combinedUsageItems(b, 'mcp', showAgents, 12), charts);

  mountUsageTable(`${prefix}-tbl-tools`, rankUsage(b.tools), 'Tool', 'Calls');
  mountUsageTable(`${prefix}-tbl-skills`, rankUsage(b.skills), 'Skill', 'Invocations');
  mountUsageTable(`${prefix}-tbl-mcp`, rankUsage(b.mcpServers), 'Server', 'Calls');
  mountUsageTable(`${prefix}-tbl-mcptools`, mcpToolRows(b), 'Tool', 'Calls');
  if (showAgents) mountUsageTable(`${prefix}-tbl-agents`, rankUsage(b.agents), 'Type', 'Count');

  if (!state.usageChartResizeBound) {
    window.addEventListener('resize', () => {
      for (const arr of Object.values(state.usageCharts)) {
        for (const c of arr) if (c.getDom()?.offsetParent) c.resize(); // skip charts in hidden views
      }
    });
    state.usageChartResizeBound = true;
  }
}

function renderToolUsage() {
  const container = $('view-tools');
  const nameByDir = {};
  for (const p of (state.projects || [])) nameByDir[p.dirName] = p.name;

  const all = state.toolUsage || [];
  // Only projects that actually recorded tool calls are worth filtering on.
  const filterable = all.filter(b => b.totalCalls > 0)
    .map(b => ({ dirName: b.dirName, name: nameByDir[b.dirName] || b.dirName }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (state.toolsFilter !== 'all' && !all.some(b => b.dirName === state.toolsFilter)) state.toolsFilter = 'all';
  const scoped = state.toolsFilter === 'all' ? all : all.filter(b => b.dirName === state.toolsFilter);
  const merged = mergeToolBuckets(scoped);
  const b = state.toolsMergeNs ? mergeNamespaces(merged) : merged;

  const opt = (v, label) => `<option value="${escHtml(v)}"${state.toolsFilter === v ? ' selected' : ''}>${escHtml(label)}</option>`;

  container.innerHTML = `
    <div class="page-header">
      <h1>Tool usage</h1>
      <div class="subtitle">Tool, skill, MCP and subagent activity across your sessions</div>
    </div>
    <div class="tools-filter">
      <span>Project</span>
      <select onchange="setToolsFilter(this.value)">
        ${opt('all', `All projects (${filterable.length})`)}
        ${filterable.map(p => opt(p.dirName, p.name)).join('')}
      </select>
    </div>
    <label class="ns-toggle" title="Collapse the plugin prefix on skills & subagent types (plugin:name → name). MCP servers are unaffected.">
      <input type="checkbox" ${state.toolsMergeNs ? 'checked' : ''} onchange="setToolsMergeNs(this.checked)">
      <span class="ns-label">Merge skill / agent namespaces</span>
    </label>
    ${usageBreakdownHtml(b, 'tools')}`;

  mountUsageBreakdown(b, 'tools');
}

// Unified horizontal bar chart: each bar coloured by its category, tooltip shows
// the category. `items` come pre-ranked and capped from combinedUsageItems().
function renderTopChart(elId, items, charts) {
  const el = document.getElementById(elId);
  if (!el || !items.length) return;
  const top = items.slice().reverse(); // reverse → largest bar on top in a horizontal layout
  const chart = echarts.init(el);
  charts.push(chart);
  chart.setOption({
    grid: { left: 4, right: 48, top: 6, bottom: 6, containLabel: true },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      backgroundColor: '#1a1e28', borderColor: '#1f2433',
      textStyle: { color: '#e2e8f0' }, extraCssText: 'box-shadow:none',
      formatter: p => {
        const d = top[p[0].dataIndex];
        return `${escHtml(d.name)}<br><span style="color:${d.color}">●</span> ${d.cat} · ${fmt(d.count)}`;
      },
    },
    xAxis: {
      type: 'value',
      axisLabel: { color: '#5a6478', fontSize: 10 },
      axisLine: { show: false }, axisTick: { show: false },
      splitLine: { lineStyle: { color: '#1f2433' } },
    },
    yAxis: {
      type: 'category', data: top.map(i => i.name),
      axisLabel: { color: '#8892a4', fontSize: 11 },
      axisLine: { show: false }, axisTick: { show: false },
    },
    series: [{
      type: 'bar',
      data: top.map(i => ({ value: i.count, itemStyle: { color: i.color, borderRadius: [0, 3, 3, 0] } })),
      barMaxWidth: 16,
      label: { show: true, position: 'right', color: '#5a6478', fontSize: 10 },
    }],
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
      <div class="stat-card green"><div class="label">Total cost</div><div class="value">${fmtCost(project.totalCost)}</div></div>
      <div class="stat-card accent"><div class="label">Input tokens</div><div class="value">${fmtMillions(project.totalUsage.input)}</div></div>
    </div>
    <div class="section-title" style="margin-bottom:12px">Sessions</div>
    <div class="table-wrap" id="sessions-table"></div>

    <div class="section-title" style="margin:28px 0 12px">Tool usage</div>
    <div id="proj-usage"><div class="usage-loading">Loading…</div></div>`;

  const sessionColumns = [
    { label: 'Title', asc: true, sort: s => s.title?.toLowerCase(), render: s => `<td class="td-name" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.hasSubagents ? '<span style="color:var(--purple);margin-right:6px">⬡</span>' : ''}${escHtml(s.title)}</td>` },
    { label: 'Model', asc: true, sort: s => modelShort(s.model), render: s => `<td><span class="badge badge-model">${escHtml(modelShort(s.model))}</span></td>` },
    { label: 'Messages', sort: s => s.messageCount, render: s => `<td class="td-num">${fmt(s.messageCount)}</td>` },
    { label: 'Agents', sort: s => s.hasSubagents ? 1 : 0, render: s => `<td class="td-num">${s.hasSubagents ? `<span style="color:var(--purple)">agents</span>` : '<span style="color:var(--text3)">—</span>'}</td>` },
    { label: 'Input', sort: s => s.totalUsage.input, render: s => `<td class="td-num" style="color:var(--accent)">${fmtMillions(s.totalUsage.input)}</td>` },
    { label: 'Output', sort: s => s.totalUsage.output, render: s => `<td class="td-num" style="color:var(--green)">${fmtMillions(s.totalUsage.output)}</td>` },
    { label: 'Cost', sort: s => s.totalCost, render: s => `<td class="td-cost">${fmtCost(s.totalCost)}</td>` },
    { label: 'Date', sort: s => s.lastTimestamp ? new Date(s.lastTimestamp).getTime() : null, render: s => `<td class="td-date">${fmtDate(s.lastTimestamp)} ${fmtTime(s.lastTimestamp)}</td>` },
  ];
  mountSortableTable($('sessions-table'), project.sessions, sessionColumns,
    s => `onclick="loadSessionDetail('${encodeURIComponent(dirName)}','${encodeURIComponent(s.file)}','${encodeURIComponent(s.projectDirName || dirName)}')"`);

  loadProjectUsage(dirName);
}

// Lazily fill the per-project tool-usage breakdown so the sessions table renders
// immediately (the scan can take seconds cold) and a tool-usage fetch failure
// degrades only this panel instead of breaking project navigation.
async function loadProjectUsage(dirName) {
  const host = $('proj-usage');
  if (!host) return;
  try {
    await fetchToolUsage();
  } catch (e) {
    host.innerHTML = `<div class="usage-loading" style="color:var(--red)">Tool usage unavailable: ${escHtml(e.message)}</div>`;
    return;
  }
  if (!host.isConnected) return; // user navigated to another project while the scan was in flight
  const projBucket = mergeToolBuckets((state.toolUsage || []).filter(x => x.dirName === dirName));
  host.innerHTML = usageBreakdownHtml(projBucket, 'proj');
  mountUsageBreakdown(projBucket, 'proj');
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
  const concurrencySegments = hasAgents ? computeConcurrencySegments(agents) : [];
  const maxParallel = concurrencySegments.reduce((m, s) => Math.max(m, s.count), hasAgents ? 1 : 0);

  // MCPs and skills pre-aggregated server-side (main + all subagents)
  const mcpBar = session.sessionMcps?.length
    ? `<div class="session-tools-bar">${session.sessionMcps.map(s => `<span class="usage-chip"><span class="tag-mcp">mcp</span>${escHtml(s)}</span>`).join('')}</div>`
    : '';
  const skillBar = session.sessionSkills?.length
    ? `<div class="session-tools-bar">${session.sessionSkills.map(s => `<span class="usage-chip"><span class="tag-skill">skill</span>${escHtml(s)}</span>`).join('')}</div>`
    : '';

  // Per-conversation breakdown, computed client-side from the loaded main
  // thread (subagent tool calls aren't in this payload — hence showAgents:false).
  const convBucket = bucketFromMessages(session.messages);
  const convToolsSection = convBucket.totalCalls > 0 ? `
    <details class="conv-tools">
      <summary>⚙ Tool usage — ${fmt(convBucket.totalCalls)} calls (excl. subagents)</summary>
      <div style="padding-top:16px">${usageBreakdownHtml(convBucket, 'conv', { showAgents: false })}</div>
    </details>` : '';

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
      ${maxParallel >= 2 ? `<div class="meta-item"><div class="meta-label">Max parallel</div><div class="meta-value" style="color:var(--orange)">${maxParallel}</div></div>` : ''}
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

    ${convToolsSection}

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

  // Charts init at width 0 inside the collapsed <details>; size them on expand.
  if (convBucket.totalCalls > 0) {
    mountUsageBreakdown(convBucket, 'conv', { showAgents: false });
    const details = container.querySelector('.conv-tools');
    details?.addEventListener('toggle', () => {
      if (details.open) (state.usageCharts.conv || []).forEach(c => c.resize());
    });
  }
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

// Sweep-line over agent [firstTimestamp, lastTimestamp] intervals → merged
// segments of constant concurrent-agent count, used to spot parallel work.
function computeConcurrencySegments(agents) {
  const intervals = (agents || [])
    .map(a => ({
      start: a.firstTimestamp ? new Date(a.firstTimestamp).getTime() : null,
      end: a.lastTimestamp ? new Date(a.lastTimestamp).getTime() : null,
      name: a.meta?.description || a.agentId || '',
    }))
    .filter(iv => iv.start != null && iv.end != null && iv.end > iv.start);
  if (!intervals.length) return [];

  const boundaries = [...new Set(intervals.flatMap(iv => [iv.start, iv.end]))].sort((a, b) => a - b);

  const segments = [];
  for (let k = 0; k < boundaries.length - 1; k++) {
    const x0 = boundaries[k], x1 = boundaries[k + 1];
    const mid = (x0 + x1) / 2;
    const active = intervals.filter(iv => iv.start <= mid && iv.end >= mid);
    if (!active.length) continue;
    segments.push({ x0, x1, count: active.length, names: active.map(a => a.name) });
  }

  const merged = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    const sameSet = last && last.count === seg.count &&
      last.names.slice().sort().join('|') === seg.names.slice().sort().join('|');
    if (last && sameSet && last.x1 === seg.x0) last.x1 = seg.x1;
    else merged.push({ ...seg });
  }
  return merged;
}

const GANTT_LABEL_W = 120;
const GANTT_ROW_H = 36;
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

  const concurrencySegments = hasAgents ? computeConcurrencySegments(agents) : [];
  const hasParallelism = concurrencySegments.some(s => s.count >= 2);

  const categories = ['👤 User', '🤖 Main AI'];
  if (hasParallelism) categories.push('⚡ Parallel');
  const agentRowOffset = 2 + (hasParallelism ? 1 : 0);
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

  // ── Parallel-agents row (concurrency sweep) ──
  if (hasParallelism) {
    shapes.push({ kind: 'rowBg', catIndex: 2, x0: tMin, x1: tMax, color: '#f97316', opacity: 0.05 });
    for (const seg of concurrencySegments) {
      if (seg.count < 2) continue;
      const opacity = Math.min(0.9, 0.3 + seg.count * 0.15);
      shapes.push({
        kind: 'bar', catIndex: 2, x0: seg.x0, x1: seg.x1,
        color: '#f97316', opacity, minWidth: 4,
        label: `${seg.count}×`, labelMinWidth: 24,
        tooltip: `<strong>${seg.count} agents in parallel</strong><br>${seg.names.map(escHtml).join(', ')}<br>${fmtDuration(seg.x1 - seg.x0)}`,
      });
    }
  }

  // ── Agent rows ──
  if (hasAgents) {
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      const catIndex = agentRowOffset + i;
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
    const h = rowH * 0.7;
    const w = Math.max(s.minWidth, end[0] - start[0]);
    const children = [{
      type: 'rect',
      shape: { x: start[0], y: start[1] - h / 2, width: w, height: h, r: 2 },
      style: { fill: s.color, opacity: s.opacity, stroke: s.borderColor || undefined, lineWidth: s.borderWidth || 0 },
    }];
    if (s.label && w > s.labelMinWidth) {
      children.push({
        type: 'text',
        style: {
          text: s.label.slice(0, Math.floor(w / 7)), x: start[0] + 4, y: start[1],
          verticalAlign: 'middle', fill: '#fff', fontSize: 10, fontWeight: 500, opacity: 0.95,
        },
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
        ${msg.usage.cache_read_input_tokens ? `<span class="usage-chip">cache r: <span class="cr">${fmt(msg.usage.cache_read_input_tokens)}</span></span>` : ''}
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

    let usageHtml = '';
    if (!isUser && m.usage) {
      const u = m.usage;
      usageHtml = `<div class="usage-inline">
        <span class="usage-chip">in: <span class="in">${fmt(u.input_tokens)}</span></span>
        <span class="usage-chip">out: <span class="out">${fmt(u.output_tokens)}</span></span>
        ${u.cache_creation_input_tokens ? `<span class="usage-chip">cache w: <span class="cw">${fmt(u.cache_creation_input_tokens)}</span></span>` : ''}
        ${u.cache_read_input_tokens ? `<span class="usage-chip">cache r: <span class="cr">${fmt(u.cache_read_input_tokens)}</span></span>` : ''}
        ${m.model ? `<span class="usage-chip" style="color:var(--accent)">${escHtml(modelShort(m.model))}</span>` : ''}
      </div>`;
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
        ${usageHtml ? `<div class="message-stats" style="padding:8px 12px">${usageHtml}</div>` : ''}
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
      ${u.cache_creation_input_tokens ? `<span class="usage-chip">cache w: <span class="cw">${fmt(u.cache_creation_input_tokens)}</span></span>` : ''}
      ${u.cache_read_input_tokens ? `<span class="usage-chip">cache r: <span class="cr">${fmt(u.cache_read_input_tokens)}</span></span>` : ''}
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
        <span class="msg-role ${isUser ? 'user' : 'assistant'}">${isUser ? '👤 User' : '🤖 Assistant'}</span>
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
    else if (a.dataset.view === 'tools') loadToolUsage();
  });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeAgentModal();
});

window.loadSessions = loadSessions;
window.loadSessionDetail = loadSessionDetail;
window.loadDashboard = loadDashboard;
window.loadToolUsage = loadToolUsage;
window.setToolsFilter = setToolsFilter;
window.setToolsMergeNs = setToolsMergeNs;
window.setMsgFilter = setMsgFilter;
window.toggleTimeline = toggleTimeline;
window.closeAgentModal = closeAgentModal;

restoreFromUrl();
