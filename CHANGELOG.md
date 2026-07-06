# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/), versions follow [SemVer](https://semver.org/).

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
