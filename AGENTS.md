# Blueprint Project Rules

## Primary Runtime

- Prefer the Python FastMCP implementation in `blueprint_fastmcp/`.
- Treat the TypeScript implementation in `src/` as the parity reference during migration.

## Product Goal

- Blueprint is a workflow engine for feature planning, implementation, review, parallel work coordination, issue tracking, and lifecycle reporting.
- Preserve SQLite-backed local state under `~/.blueprint/` or `$BLUEPRINT_HOME`.

## Working Rules

- Keep OpenCode integration first-class via `opencode.jsonc` and `.opencode/instructions.md`.
- Prefer extending the Python implementation before adding new TypeScript functionality.
- Match existing Blueprint tool names whenever porting behavior.
- Keep migrations additive and deterministic.
- Update docs when runtime or setup behavior changes.

## Verification

- Run Python verification with `.venv/bin/python -m unittest discover -s python_tests`.
- Use `.venv/bin/python -m blueprint_fastmcp` to run the local HTTP MCP server.
