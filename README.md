# ccanalyzer

A web-based dashboard for analyzing your [Claude Code](https://claude.ai/code) sessions — costs, token usage, agent activity, and conversation timelines.

![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
[![npm](https://img.shields.io/npm/v/ccanalyzer)](https://www.npmjs.com/package/ccanalyzer)

## Usage

```bash
npx -y ccanalyzer@latest
```

Opens a local dashboard at **http://localhost:3737** in your browser.

If port 3737 is already in use, specify a different port with `-p`:

```bash
npx -y ccanalyzer@latest -p 3738
```

By default the server binds to `127.0.0.1` (localhost only). To expose it — for
example when running inside a Docker container where port-forwarding routes
through `eth0` rather than the container loopback — bind to all interfaces via
the `HOST` env var or the `--host` flag:

```bash
HOST=0.0.0.0 npx -y ccanalyzer@latest
# or
npx -y ccanalyzer@latest --host 0.0.0.0
```

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

## Docker

A ready-to-use [`docker-compose.yaml`](./docker-compose.yaml) is included:

```yaml
services:
  node:
    image: node:22-slim
    restart: unless-stopped
    environment:
      - HOST=0.0.0.0                        # bind all interfaces (see note below)
      - CLAUDE_CONFIG_DIR=/data/.claude     # where ccanalyzer reads sessions from
    volumes:
      - ${HOME}/.claude:/data/.claude:ro    # host Claude data, mounted read-only
    command: [npx, -y, ccanalyzer@latest, -p, "${APP_PORT}"]
    ports:
      - "${APP_PORT}:${APP_PORT}"
```

With an `.env` next to it:

```
APP_PORT=3737
```

Then:

```bash
docker compose up
```

Two things are essential in a container:

- **`HOST=0.0.0.0`** — the server defaults to `127.0.0.1`, which inside a
  container only covers the container loopback. Docker's port-forwarding routes
  through `eth0`, so without this you get `connection reset by peer`.
- **Mounting your Claude data** — ccanalyzer reads sessions from
  `~/.claude/projects/**`. Mount the host's `~/.claude` into the container and
  point `CLAUDE_CONFIG_DIR` at it, otherwise the dashboard starts up empty.

## Requirements

- Node.js >= 18
- Claude Code sessions in `~/.claude/projects/` (or your custom `CLAUDE_CONFIG_DIR`)

## License

MIT
