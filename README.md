# Blueprint

Blueprint is a local MCP server for structured feature planning, build execution,
review gates, issue tracking, parallel work assignment, merge coordination, and
development history reporting.

This repo now contains a Python FastMCP runtime in `blueprint_fastmcp/` and an OpenCode project configuration for local use.
The original TypeScript implementation remains in `src/` as a migration reference.

## What It Does

- Stores Blueprint state in local SQLite under `~/.blueprint/`
- Exposes MCP tools for feature, FU, AC, cycle, issue, lock, and gate workflows
- Supports parallel execution with work locks, dependency graphs, merge points, and coordinator logic
- Generates lifecycle exports and recurrence analysis
- Includes OpenCode-first project instructions, agents, commands, and optional compaction plugin support

## Project Layout

- `src/db/` - SQLite bootstrap, migrations, and query layer
- `src/tools/` - MCP tool definitions and handlers
- `src/entities/` - domain types and status constants
- `src/coordinator/` - build coordinator loop scaffolding
- `src/export/` - Markdown export generation
- `src/analysis/` - recurrence and history analysis
- `blueprint_fastmcp/` - Python FastMCP rewrite package
- `python_tests/` - Python rewrite unit tests
- `.blueprint/skills/` - role behavior specs
- `.opencode/` - OpenCode instructions and plugin support
- `.plans/` - implementation specs used to build the system

## Python FastMCP Commands

```bash
python3.13 -m venv .venv
source .venv/bin/activate
pip install -e .
.venv/bin/python -m unittest discover -s python_tests
.venv/bin/python -m blueprint_fastmcp
./install_opencode.sh
```

Default Python endpoint: `http://127.0.0.1:8000/mcp`

## OpenCode

- Project config: `opencode.jsonc`
- Project instructions: `.opencode/instructions.md`
- Local MCP server command: `.venv/bin/python -m blueprint_fastmcp`
- Optional compaction plugin: `.opencode/plugin.ts`
- Global installer: `install_opencode.py`
- Shell installer: `install_opencode.sh`
- Claude Code installer: `install_claude_code.py`
- Claude Code shell installer: `install_claude_code.sh`

OpenCode-native roles configured in `opencode.jsonc`:

- `blueprint-planner`
- `blueprint-builder`
- `blueprint-build`
- `blueprint-review`
- `blueprint-coordinator`
- `blueprint-worker`
- `blueprint-skeptic`

OpenCode-native commands configured in `opencode.jsonc`:

- `blueprint-status`
- `blueprint-test`
- `blueprint-product`

## Legacy TypeScript Commands

```bash
bun install
bun run build
bun run test
```

## Runtime

- Python entrypoint: `blueprint_fastmcp/__main__.py`
- Python transport: MCP Streamable HTTP
- Python endpoint path: `/mcp`
- Legacy TypeScript entrypoint: `src/index.ts`
- Local data directory: `~/.blueprint/` or `$BLUEPRINT_HOME`

## Key Capabilities

- feature creation, listing, and full retrieval
- function unit and acceptance criteria management
- plan cycles, build cycles, and review submission
- issue filing, listing, and resolution
- plan/build approval gates and lifecycle transitions
- dependencies, merge points, available work, locks, and parallel status
- checkpoints, resume context, export, history, and coordinator loop

## Status

- The original TypeScript repo includes the Phase 1-4 implementation scaffold described in `/.plans/`.
- The Python FastMCP runtime now covers the Blueprint tool surface needed for local/OpenCode usage, backed by SQLite and served over Streamable HTTP.

Verification artifacts:

- Python tests: `python_tests/test_blueprint_fastmcp.py`
- OpenCode config: `opencode.jsonc`
- OpenCode compaction plugin: `.opencode/plugin.ts`
- Global installer: `install_opencode.py`
- Shell installer: `install_opencode.sh`

See `INSTALL.md` for setup instructions.
