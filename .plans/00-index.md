# Blueprint — Development Plan Index

## Phases

| Phase | File | Status | Depends On |
|-------|------|--------|------------|
| 1 | [phase-1-core-mcp-server.md](./phase-1-core-mcp-server.md) | pending | — |
| 2 | [phase-2-cycles-issues-gates.md](./phase-2-cycles-issues-gates.md) | pending | Phase 1 |
| 3 | [phase-3-parallel-merge.md](./phase-3-parallel-merge.md) | pending | Phase 2 |
| 4 | [phase-4-skills-subagents.md](./phase-4-skills-subagents.md) | pending | Phase 3 |

## Cross-Phase Dependency Graph

```
Phase 1: Core MCP Server
  ├── WU-1.1: Project scaffold + SQLite setup
  ├── WU-1.2: Entity schemas (Feature, FU, AC)          ← depends on WU-1.1
  ├── WU-1.3: MCP server bootstrap                      ← depends on WU-1.1
  ├── WU-1.4: Feature management tools                  ← depends on WU-1.2, WU-1.3, WU-1.6
  ├── WU-1.5: FunctionUnit + AC tools (no dep tools)    ← depends on WU-1.2, WU-1.3, WU-1.6
  ├── WU-1.6: Status audit log table                    ← depends on WU-1.2
  └── WU-1.7: WorkLock table + watchdog reaper          ← depends on WU-1.2, WU-1.6

Phase 2: Cycles, Issues, Gates
  ├── WU-2.1: PlanCycle entity + state machine           ← depends on WU-1.4
  ├── WU-2.2: BuildCycle entity + state machine          ← depends on WU-1.4
  ├── WU-2.2b: blueprint_submit_for_review               ← depends on WU-2.2
  ├── WU-2.2c: blueprint_checkpoint + complete_fu        ← depends on WU-2.2
  ├── WU-2.2d: blueprint_resume                          ← depends on WU-2.2c, WU-2.3
  ├── WU-2.3: Issue entity + CRUD tools                  ← depends on WU-1.2
  ├── WU-2.4: Plan approval gate (server-enforced)       ← depends on WU-2.1, WU-2.3
  ├── WU-2.5: Build approval gate (server-enforced)      ← depends on WU-2.2b, WU-2.3
  ├── WU-2.6: blueprint_get_context tool                 ← depends on WU-2.2d, WU-2.3
  └── WU-2.7: Feature lifecycle state transitions        ← depends on WU-2.4, WU-2.5

Phase 3: Parallel & Merge
  ├── WU-3.1: FU dependency graph storage + traversal    ← depends on WU-1.5
  │           (includes add_dependency, get_dependency_graph tools,
  │            and additionalBlockCheck hook for MergePoint integration)
  ├── WU-3.4: MergePoint entity + tools                  ← depends on WU-3.1
  ├── WU-3.2: blueprint_get_available_work (atomic lock) ← depends on WU-1.7, WU-3.4
  ├── WU-3.3: blueprint_heartbeat + release_lock         ← depends on WU-1.7
  ├── WU-3.5: blueprint_get_parallel_status              ← depends on WU-3.2, WU-3.4
  └── WU-3.6: Integration issue categories               ← depends on WU-2.3

Phase 4: Skills + Subagents
  ├── WU-4.1: Plan skill file (.blueprint/skills/plan.md)     ← depends on WU-2.4
  ├── WU-4.2: Verify skill file (.blueprint/skills/verify.md) ← depends on WU-2.5
  ├── WU-4.3: Build skill file (.blueprint/skills/build.md)   ← depends on WU-3.2
  ├── WU-4.4: Subagent Markdown definitions                   ← depends on WU-4.1–4.3
  ├── WU-4.5: Coordinator loop                                ← depends on WU-3.5, WU-4.4
  ├── WU-4.6: blueprint_export (Markdown report)              ← depends on WU-2.6
  └── WU-4.7: blueprint_get_history (recurrence analysis)     ← depends on WU-2.6, WU-1.6
```

## Parallel Execution Map

Within each phase, work units with no mutual dependency can be assigned to
separate agents simultaneously. The following groups can run in parallel:

```
Phase 1:
  Group A: WU-1.1 (must complete first — foundation)
  Group B: WU-1.2, WU-1.3 (parallel after WU-1.1)
  Group C: WU-1.6 (after Group B)
  Group D: WU-1.4, WU-1.5, WU-1.7 (parallel after Group C)

Phase 2:
  Group A: WU-2.1, WU-2.2, WU-2.3 (parallel — independent entities)
  Group B: WU-2.2b, WU-2.2c, WU-2.4 (parallel after Group A)
  Group C: WU-2.2d, WU-2.5 (parallel after Group B)
  Group D: WU-2.6 (after WU-2.2d)
  Group E: WU-2.7 (after WU-2.4 + WU-2.5)

Phase 3:
  Group A: WU-3.1, WU-3.6 (parallel — independent)
  Group B: WU-3.3, WU-3.4 (parallel after WU-3.1; WU-3.3 only needs WU-1.7)
  Group C: WU-3.2 (after WU-3.4 + WU-1.7)
  Group D: WU-3.5 (after WU-3.2 + WU-3.4)

Phase 4:
  Group A: WU-4.1, WU-4.2, WU-4.3, WU-4.6, WU-4.7 (parallel — independent files)
  Group B: WU-4.4 (after WU-4.1–4.3)
  Group C: WU-4.5 (after WU-4.4)
```

## File Ownership Convention

To prevent parallel agent collisions, each work unit declares the files it
owns. An agent MUST NOT modify files outside its declared ownership set.

If two work units need to touch the same file, they must be sequenced
(not parallelized), or one must expose an interface the other imports.

## Conventions

- Each work unit has a unique ID: `WU-{phase}.{number}`
- Acceptance criteria use the same severity model as the spec: `must`, `should`, `nice_to_have`
- A work unit is "done" when all `must` criteria pass with test evidence
- Work units marked `[PARALLEL-SAFE]` can be assigned to concurrent agents
- Work units marked `[SEQUENTIAL]` must wait for their stated dependency
