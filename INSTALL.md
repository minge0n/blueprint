# Install

This repo currently supports two tracks:

- Python FastMCP rewrite in `blueprint_fastmcp/`
- Legacy TypeScript implementation in `src/`

The recommended path is the Python FastMCP setup below.

## Python FastMCP Requirements

- Python `3.13`
- A virtual environment such as `.venv`

## Python FastMCP Setup

### 1. Clone

```bash
git clone https://github.com/minge0n/blueprint.git
cd blueprint
```

### 2. Create Or Reuse `.venv`

```bash
python3.13 -m venv .venv
source .venv/bin/activate
```

### 3. Install Dependencies

```bash
pip install -e .
```

### 4. Run Tests

```bash
.venv/bin/python -m unittest discover -s python_tests
```

### 5. Run The HTTP Server

```bash
.venv/bin/python -m blueprint_fastmcp
```

Default endpoint:

```text
http://127.0.0.1:8000/mcp
```

Optional environment variables:

```bash
export BLUEPRINT_HOST=127.0.0.1
export BLUEPRINT_PORT=8000
export BLUEPRINT_MCP_PATH=/mcp
```

### 6. Use With OpenCode

This repo already includes OpenCode project wiring:

- `opencode.jsonc`
- `.opencode/instructions.md`
- `AGENTS.md`
- `.opencode/plugin.ts`

OpenCode can start the local Blueprint MCP server from the project config. This repo also includes a small optional plugin that injects Blueprint status/resume guidance into session compaction.

OpenCode smoke-check flow:

1. Open the repo in OpenCode
2. Confirm the project picks up `opencode.jsonc`
3. Start or let OpenCode start the local `blueprint` MCP server
4. Run the configured project command or ask OpenCode to use `blueprint_resume`
5. Confirm the session can call Blueprint MCP tools from the local server

Recommended first OpenCode check:

```text
Use blueprint_resume and summarize the active Blueprint status.
```

### 7. Install Globally Into OpenCode

To write a global OpenCode config under `~/.config/opencode/opencode.json`:

```bash
./install_opencode.sh
```

This installs:

- a global `mcp.blueprint` entry
- OpenCode Blueprint agents and commands
- the Blueprint compaction plugin reference
- it merges into an existing global `~/.config/opencode/opencode.json` if one already exists

If you want a different config directory:

```bash
./install_opencode.sh --config-dir /custom/path/opencode
```

One-line download/install form after this script is hosted at a stable raw URL:

```bash
curl -fsSL https://raw.githubusercontent.com/minge0n/blueprint/main/install_opencode.sh | bash
```

### 8. Install Globally Into Claude Code

To install Blueprint-oriented Claude Code settings and global agents under `~/.claude`:

```bash
./install_claude_code.sh
```

This installs:

- `~/.claude/settings.json` env entries for Blueprint runtime defaults
- `~/.claude/agents/blueprint-planner.md`
- `~/.claude/agents/blueprint-builder.md`
- merge-safe updates if `~/.claude/settings.json` already exists

If you want a different config directory:

```bash
./install_claude_code.sh --config-dir /custom/path/.claude
```

## Shared Data Directory

By default Blueprint writes local runtime data to:

```text
~/.blueprint/
```

To override it:

```bash
export BLUEPRINT_HOME=/path/to/custom-blueprint-home
```

## Legacy TypeScript Setup

If you need the old TypeScript implementation during migration:

```bash
bun install
bun run build
bun run test
bun run dev
```

## Notes

- The Python FastMCP runtime is the primary implementation for this repo
- The TypeScript implementation remains available as a parity reference during migration
- OpenCode is the primary agent/runtime integration target for this repo
- SQLite database files are created automatically on first start
- Runtime exports are written under `~/.blueprint/exports/`
- Local database artifacts are ignored by git via `.gitignore`
