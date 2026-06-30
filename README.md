# ccanalyzer

A web-based dashboard for analyzing your [Claude Code](https://claude.ai/code) sessions — costs, token usage, agent activity, and conversation timelines.

![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
[![npm](https://img.shields.io/npm/v/ccanalyzer)](https://www.npmjs.com/package/ccanalyzer)

## Usage

```bash
npx -y ccanalyzer@latest
```

Opens a local dashboard at **http://localhost:3737** in your browser.

## Features

- **Dashboard** — all projects with token counts, costs, and last activity
- **Session browser** — list sessions per project sorted by recency
- **Session detail** — full message thread with token/cost breakdown per exchange
- **Gantt timeline** — visual timeline of user turns, AI responses, and spawned agents
  - Click a **message bar** → see the exchange inline
  - Click an **agent bar** → open the full agent conversation in a popup
- **Agent popup** — complete agent conversation with stats (input/output tokens, cost)

## Custom config directory

By default, ccanalyzer reads `~/.claude`. To analyze a different Claude config directory (e.g. a work profile or a custom `CLAUDE_CONFIG_DIR`):

```bash
CLAUDE_CONFIG_DIR=/path/to/your/.claude npx -y ccanalyzer@latest
```

Example — analyze a secondary profile:

```bash
CLAUDE_CONFIG_DIR=~/.claude-work npx -y ccanalyzer@latest
```

## Requirements

- Node.js >= 18
- Claude Code sessions in `~/.claude/projects/` (or your custom `CLAUDE_CONFIG_DIR`)

## License

MIT
