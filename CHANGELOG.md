# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/), versions follow [SemVer](https://semver.org/).

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
