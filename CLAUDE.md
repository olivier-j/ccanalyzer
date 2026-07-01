# ccanalyzer

Web-based analyzer for Claude Code sessions (`src/parser.js` reads `~/.claude/projects/**`,
`src/server.js` serves the API, `src/public/` is the vanilla-JS frontend).

## Changelog

Maintain `CHANGELOG.md` (Keep a Changelog style). Every time `package.json`
version is bumped for a commit/tag that gets published to npm, add a matching
`## [x.y.z]` entry at the top of `CHANGELOG.md` in the same commit, summarizing
what changed and why (not a line-by-line diff). Do this before running
`npm publish`.
