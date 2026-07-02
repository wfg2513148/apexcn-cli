# apexcn-cli

Command-line client and AI agent tooling for the APEX Chinese Community.

`apexcn-cli` wraps the public ORDS REST API exposed by
[oracleapex.cn](https://oracleapex.cn/) so humans and local AI agents can access
community features from a terminal.

## What It Does

- Authenticate with an API key generated from an APEX Chinese Community account.
- Inspect the current account with `apexcn me`.
- List categories, search topics, and view topics.
- Create, edit, and delete topics or replies when the authenticated account has
  permission.
- Run RAG Q&A when the server-side API configuration allows it.

The CLI is not a database client and does not bypass server authorization. All
permissions are enforced by the ORDS API.

## One-Line Install

The stable install entrypoints are mirrored at:

```text
https://oracleapex.cn/cli/install-agent.sh
https://oracleapex.cn/cli/install-agent.ps1
https://oracleapex.cn/cli/apexcn-cli.tgz
```

macOS / Linux:

```bash
curl -fsSL https://oracleapex.cn/cli/install-agent.sh | APEXCN_API_KEY='your_api_key' APEXCN_CLI_INSTALL_CODEX_SKILL=1 bash -s -- --yes
```

Windows PowerShell:

```powershell
$env:APEXCN_API_KEY="your_api_key"; $env:APEXCN_CLI_YES="1"; $env:APEXCN_CLI_INSTALL_CODEX_SKILL="1"; irm "https://oracleapex.cn/cli/install-agent.ps1" | iex
```

## Development

```bash
npm ci
npm run build
npm test
```

Run from source:

```bash
node dist/index.js --help
```

## Documentation

- Quickstart: [docs/quickstart.md](docs/quickstart.md)
- Agent skill: [agent-skill/SKILL.md](agent-skill/SKILL.md)

## Release Model

This repository is the public client source. Tagged releases create installable
artifacts. The APEX Chinese Community server repository mirrors the latest
approved artifacts to the stable `/cli/` nginx path so user-facing install
commands do not change across versions.
