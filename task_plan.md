# Task Plan: FastMCP Rewrite

## Goal
Replace the current TypeScript MCP server implementation with a Python FastMCP-based server while preserving Blueprint's core workflow and tools, and make it usable from OpenCode.

## Phases
- [x] Phase 1: Confirm rewrite direction
- [x] Phase 2: Research FastMCP shape and map current architecture
- [x] Phase 3: Scaffold Python project and core server
- [x] Phase 4: Port core Blueprint persistence and tools
- [x] Phase 5: Add OpenCode project integration files
- [x] Phase 6: Port workflow cycles, issues, and review gates
- [x] Phase 7: Port resume, checkpoint, locks, dependencies, and merge points
- [x] Phase 8: Port export, history, and coordinator flows
- [x] Phase 9: Finalize docs and product verification

## Key Questions
1. Which existing TypeScript modules should be ported first to preserve a runnable core?
2. What FastMCP server structure best fits the current Blueprint tool surface?

## Decisions Made
- Rewrite target: Python with FastMCP
- Preserve SQLite-backed local state model from the current implementation
- Use Streamable HTTP as the default Python transport
- Start with the milestone-1 tool surface before porting cycles, issues, and parallel orchestration
- Use OpenCode project config and local MCP integration instead of introducing a plugin first
- Add a small OpenCode compaction plugin only for Blueprint-specific continuity state

## Errors Encountered
- OpenCode readiness audit found lingering Claude-specific repo artifacts and missing OpenCode verification details; resolved by removing `.claude/agents/`, adding OpenCode-only roles/commands, and documenting smoke checks.

## Status
**Current progress** - Python FastMCP product port is implemented, documented, and verified for local/OpenCode usage.
