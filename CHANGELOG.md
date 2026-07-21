# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/), versions follow [SemVer](https://semver.org/).

## [2.3.0] — 2026-07-21
- Add a **Lines generated** metric per project on the Dashboard: a new column in
  the project table plus a summary stat card, counting lines Claude authored
  through the `Write`, `Edit`, `MultiEdit` and `NotebookEdit` tools (produced
  text, not net diff — a proxy for authoring volume). Computed per session in
  `src/parser.js` and aggregated per project; the OpenCode source computes the
  same metric from its tool parts for parity.
- Add a **date-range filter** (top-right of the Dashboard): this week, this
  month, last 3 months, last 6 months, all time. Stat cards, the project table
  and the daily-activity chart all re-aggregate to the selected window. Filtering
  is client-side over the sessions already loaded, so switching ranges is instant.
- Fix the **Daily activity** chart freezing on an old date. It read Claude Code's
  `~/.claude/stats-cache.json`, which Claude Code can stop regenerating (observed
  stuck for weeks after a CC update), so the chart stopped days in the past even
  though sessions kept coming. `src/parser.js` now computes `dailyActivity`
  (per-day message / tool-call / session counts) directly from the session JSONL
  — always current — and only falls back to the cached history for older days no
  longer on disk. The computation dedups streamed assistant continuations like
  the rest of the parser and is memoised on the same short TTL as the tool-usage
  scan. Partial values written mid-day by Claude Code are replaced by the full
  computed day on overlap.

## [2.2.0] — 2026-07-10
- Add **OpenCode** as a selectable data source (`--source opencode` or
  `CCANALYZER_SOURCE=opencode`). A source-adapter layer (`src/sources/opencode.js`)
  reads OpenCode's local SQLite store (`opencode.db`) read-only and normalises it
  onto the existing model, so the dashboard, session browser, Gantt timeline and
  tool-usage views work unchanged. Costs use OpenCode's own per-message figures
  (multi-provider accurate). Requires Node 22+ (`node:sqlite`) for this source;
  the Claude Code source is unchanged and stays the default. Location is
  auto-detected (`$XDG_DATA_HOME/opencode`) or set via `OPENCODE_DATA_DIR`.
- Handle very large sessions (10k+ messages) without freezing:
  - Session detail now ships only the **first page** of message bodies plus a
    compact per-message **timeline**; the rest stream in on scroll via a new
    `GET …/sessions/:file/messages?offset&limit` endpoint.
  - The message list renders in batches (IntersectionObserver) with
    `content-visibility` so off-screen messages cost nothing.
  - The Gantt aggregates user/assistant rows into buckets past a threshold.
  - OpenCode defers its heavy per-message timeline + tool aggregation to a
    background `GET …/sessions/:file/insights` call so opening a huge session is
    instant; the Claude parser gains a parse cache so pagination doesn't re-read
    the JSONL on every page.

## [2.1.5] — 2026-07-07
- Add a tool/skill/MCP usage dashboard: `src/parser.js` now aggregates tool,
  skill, and MCP invocations, surfaced in a new dashboard view in the frontend.
- Republish the sortable project/session table columns: the feature was merged
  before 2.1.4 but the 2.1.4 npm artifact was built from a stale working tree
  and shipped the pre-merge `app.js`, so the sortable columns never reached npm.
  This release ships the correct, up-to-date sources.
- Dev: add a `dev` npm script (`node --watch bin/index.js`).

## [2.1.4] — 2026-07-06
- Docs: add a session-detail screenshot to the README (shown on GitHub and npm).

## [2.1.3] — 2026-07-06
- Open the project to contributions: add `LICENSE` (MIT), `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, `SECURITY.md`, and GitHub issue/PR templates under
  `.github/`.
- README: add a Contributing section and link the license file.
- `package.json`: add `author`, `bugs`, and richer `keywords`
  (`anthropic`, `dashboard`, `token-usage`, `cost-tracking`, `cli`).

## [2.1.2] — 2026-07-06
- Docs: add a Docker section to the README and ship a ready-to-use
  `docker-compose.yaml` + `.env`, documenting the `HOST=0.0.0.0` bind and the
  `~/.claude` volume mount needed to run ccanalyzer in a container.

## [2.1.1] — 2026-07-06
- Fix "connection reset by peer" when running in Docker: the server bound
  hard-coded to `127.0.0.1`, which inside a container only covers the container
  loopback, so Docker's port-forwarding (routed via `eth0`) could not reach the
  backend. The bind host is now configurable via the `HOST` env var or `--host`
  flag; it still defaults to `127.0.0.1` so local runs stay off the network. Set
  `HOST=0.0.0.0` in Docker.

## [2.1.0] — 2026-07-01
- Add a "Parallel" row to the session timeline (Gantt chart) that highlights time
  segments where 2+ subagents run concurrently, with a count label and tooltip
  listing the overlapping agents.
- Add a "Max parallel" stat to the session header.

## [2.0.0]
- Dedupe streamed assistant turns so usage/cost and the UI no longer count/display
  the same turn 2-3x.

## [1.4.1]
- Fix timeline bar label readability.

## [1.4.0]
- Migrate charts to ECharts (daily activity + session timeline).

## [1.3.1]
- Widen the timeline label column; show full agent names with auto-compress.

## [1.3.0]
- Translate UI to English.

## [1.2.0]
- Group worktree sessions under their parent project; resolve correct project
  names via `cwd`.

## [1.1.3]
- Add `-p` flag for a custom port; hint on `EADDRINUSE`.

## [1.1.2]
- Fix npm package (`bin` field cleanup).

## [1.1.1]
- Show skills used by subagents in message footers.

## [1.1.0]
- Display MCP/skill usage, agent context, and persist view state in the URL;
  general UX polish.

## [1.0.1]
- Add README.

## [1.0.0]
- Initial release — ccanalyzer web dashboard for Claude Code sessions.
