# Notes: FastMCP Rewrite

## Current Findings

- The current implementation is a TypeScript MCP server with tool registration in `src/tools/`.
- Persistence is SQLite-based with migrations and query helpers under `src/db/`.
- Server startup currently uses stdio transport, but the user now wants a Python/FastMCP rewrite instead.
- Rewrite will need Python packaging, server bootstrap, database access, tool definitions, and updated docs.
- FastMCP `run(transport="streamable-http", host=..., port=..., path=...)` matches the requested HTTP-based deployment model.
- The Python rewrite now includes `pyproject.toml`, the `blueprint_fastmcp/` package, and `python_tests/`.
- Milestone-1 Python tools implemented so far: feature creation/list/get, function unit creation, AC creation, and AC status updates.
- OpenCode supports project-local `opencode.json` or `opencode.jsonc`, custom agents, custom commands, instruction files, and local MCP server definitions.
- OpenCode plugins are optional; current repo needs do not require one yet because config plus MCP wiring is sufficient.
- The Python runtime now exposes the broader Blueprint flow: cycles, issues, gates, dependencies, merge points, locks, resume/context, export/history, and coordinator scaffolding.
- A small OpenCode plugin is justified here specifically for Blueprint-aware compaction continuity, using the `experimental.session.compacting` hook to preserve workflow state and the recommended next MCP resume path.
