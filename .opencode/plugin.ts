import type { Plugin } from "@opencode-ai/plugin"

const CURRENT_STATUS = `
## Blueprint Current Status

- Runtime: Python FastMCP in blueprint_fastmcp/
- Local MCP server: .venv/bin/python -m blueprint_fastmcp
- Endpoint: http://127.0.0.1:8000/mcp
- Primary OpenCode config: opencode.jsonc
- Local workflow state: use blueprint_resume and blueprint_get_context before major work
`

const plugin: Plugin = async () => {
  return {
    "experimental.session.compacting": async (_input, output) => {
      output.context.push(CURRENT_STATUS)
      output.context.push(`
## Blueprint Compaction Rules

- Preserve the active feature id and current cycle
- Preserve any current lock id and assigned function unit
- Preserve unresolved issues and blocking dependencies
- Preserve the next recommended Blueprint MCP call
- Prefer resuming through blueprint_resume and blueprint_get_context after compaction
`)
    },
  }
}

export default plugin
