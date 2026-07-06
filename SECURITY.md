# Security Policy

## Supported Versions

Only the latest published version of ccanalyzer receives security fixes. Please
upgrade (`npx ccanalyzer@latest`) before reporting.

## Reporting a Vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, report privately using GitHub's
[**Report a vulnerability**](https://github.com/olivier-j/ccanalyzer/security/advisories/new)
button (Security → Advisories), or by emailing the maintainer.

Please include:

- A description of the vulnerability and its impact
- Steps to reproduce
- Any suggested remediation

You can expect an acknowledgement within a few days. We'll work with you to
understand and resolve the issue promptly, and will credit you in the release
notes unless you prefer to remain anonymous.

## Scope note

ccanalyzer reads local Claude Code session data and serves it on a local web
server. By default it binds to `127.0.0.1`. Be aware that exposing it on
`0.0.0.0` (e.g. via `HOST=0.0.0.0`) makes your session data reachable by anyone
who can reach that port — only do so on trusted networks.
