# Contributing to ccanalyzer

Thanks for your interest in improving ccanalyzer! Contributions of all kinds are
welcome — bug reports, feature ideas, documentation fixes, and pull requests.

## Getting started

```bash
git clone https://github.com/olivier-j/ccanalyzer.git
cd ccanalyzer
npm install
npm start        # launches the dashboard on http://localhost:3737
```

Requirements: **Node.js >= 18**.

By default the app reads your real Claude Code data from `~/.claude`. To develop
against a different dataset, point `CLAUDE_CONFIG_DIR` at another directory:

```bash
CLAUDE_CONFIG_DIR=~/.claude-test npm start
```

## Project layout

| Path             | Responsibility                                        |
| ---------------- | ----------------------------------------------------- |
| `src/parser.js`  | Reads and parses sessions from `~/.claude/projects/**`|
| `src/server.js`  | Express API server                                    |
| `src/public/`    | Vanilla-JS frontend (no build step)                   |
| `bin/index.js`   | CLI entry point                                       |

There is no build or transpile step — the frontend is plain HTML/CSS/JS.

## Reporting bugs & requesting features

Please [open an issue](https://github.com/olivier-j/ccanalyzer/issues). Include:

- What you expected vs. what happened
- Steps to reproduce
- Node version, OS, and ccanalyzer version (`npx ccanalyzer@latest --version` or
  the `package.json` version you're running)

## Submitting a pull request

1. Fork the repo and create a branch from `main`
   (`git checkout -b fix/short-description`).
2. Keep changes focused — one logical change per PR.
3. Match the surrounding code style (vanilla JS, no framework).
4. Test manually: run `npm start` and verify the affected views still work.
5. If you bump the `package.json` version for a release, add a matching
   `## [x.y.z]` entry at the top of [`CHANGELOG.md`](./CHANGELOG.md)
   (Keep a Changelog style) in the same commit.
6. Write a clear PR description explaining the *why*, not just the *what*.

## Commit messages

Keep them concise and descriptive. Reference an issue number when relevant
(e.g. `fix: handle empty projects dir (#12)`).

## Code of conduct

By participating, you agree to abide by our
[Code of Conduct](./CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](./LICENSE) that covers the project.
