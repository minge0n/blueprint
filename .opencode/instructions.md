# OpenCode Instructions

## Repo Focus

- Build toward full Blueprint product parity in Python FastMCP.
- Use `blueprint_fastmcp/` for new runtime logic.
- Use `src/` as the migration reference when a workflow has not yet been ported.

## Tooling

- Prefer Python 3.13 in `.venv`.
- Prefer local SQLite state through the shared `BLUEPRINT_HOME` directory.
- Prefer OpenCode project commands and the local MCP server configured in `opencode.jsonc`.

## Priorities

1. Workflow correctness
2. Tool-name compatibility
3. OpenCode usability
4. Documentation and verification

## Current Product State

- Implemented in Python: features, function units, acceptance criteria, plan/build cycles, issues, review gates, resume/checkpoint basics, dependencies, merge points, available work, locks, parallel status, export, history, and coordinator scaffolding.
- Use `src/` as the behavioral reference if a Python workflow needs refinement.

## No Plugin Required Yet

- Use built-in OpenCode project config, instructions, agents, commands, and local MCP wiring first.
- Add a plugin only if a concrete OpenCode limitation appears that cannot be solved with config or MCP tools.
