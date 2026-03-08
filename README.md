# Blueprint

Blueprint is a local MCP server for structured feature planning, build execution,
review gates, issue tracking, parallel work assignment, merge coordination, and
development history reporting.

## What It Does

- Stores Blueprint state in local SQLite under `~/.blueprint/`
- Exposes MCP tools over stdio for feature, FU, AC, cycle, issue, lock, and gate workflows
- Supports parallel execution with work locks, dependency graphs, merge points, and coordinator logic
- Generates lifecycle exports and recurrence analysis
- Includes skill files and subagent definitions for Architect, Skeptic, and Executor roles

## Project Layout

- `src/db/` - SQLite bootstrap, migrations, and query layer
- `src/tools/` - MCP tool definitions and handlers
- `src/entities/` - domain types and status constants
- `src/coordinator/` - build coordinator loop scaffolding
- `src/export/` - Markdown export generation
- `src/analysis/` - recurrence and history analysis
- `.blueprint/skills/` - role behavior specs
- `.claude/agents/` - subagent definitions
- `.plans/` - implementation specs used to build the system

## Commands

```bash
bun install
bun run build
bun run test
bun run dev
```

## Runtime

- Dev entrypoint: `src/index.ts`
- Production entrypoint after build: `dist/index.js`
- Transport: MCP stdio server
- Local data directory: `~/.blueprint/` or `$BLUEPRINT_HOME`

## Key Capabilities

- `blueprint_resume`
- `blueprint_get_available_work`
- `blueprint_get_parallel_status`
- `blueprint_submit_for_review`
- `blueprint_approve_plan` / `blueprint_reject_plan`
- `blueprint_approve_build` / `blueprint_reject_build`
- `blueprint_export`
- `blueprint_get_history`

## Status

The repo includes the full Phase 1-4 implementation scaffold described in `/.plans/`, with build and test verification passing via Bun.

See `INSTALL.md` for setup instructions.
