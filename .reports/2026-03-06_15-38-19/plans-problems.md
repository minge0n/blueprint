# `.plans` Review Report

- Generated: `2026-03-06 15:38:19`
- Scope: review of all files under `.plans/` for contradictions, missing dependencies, and unimplementable acceptance criteria

## Findings

### High

1. Phase 1 schedules `blueprint_resume` before cycles, issues, checkpoints, and parallel state exist, but its required response includes those concepts.
   - Refs: `.plans/phase-1-core-mcp-server.md:3`, `.plans/phase-1-core-mcp-server.md:187`, `.plans/phase-1-core-mcp-server.md:190`, `.plans/00-index.md:21`

2. WU-1.7 is out of order: `blueprint_checkpoint({ build_cycle_id, ... })` depends on `build_cycles` and `checkpoints`, which are only introduced in Phase 2. `blueprint_complete_fu` also requires FU status `in_progress`, which is not assigned until Phase 3 lock acquisition.
   - Refs: `.plans/phase-1-core-mcp-server.md:213`, `.plans/phase-1-core-mcp-server.md:217`, `.plans/phase-2-cycles-issues-gates.md:72`, `.plans/phase-3-parallel-merge.md:75`

3. WU-1.5 defines FU dependency tools in Phase 1, but the backing `fu_dependencies` table is only introduced in Phase 3.
   - Refs: `.plans/phase-1-core-mcp-server.md:161`, `.plans/phase-1-core-mcp-server.md:162`, `.plans/phase-3-parallel-merge.md:32`, `.plans/phase-3-parallel-merge.md:41`

4. The plan gate uses the wrong issue severity vocabulary: it blocks on open `should` issues, but issue severity is defined as `critical`, `major`, `minor`, `nitpick`.
   - Refs: `.plans/phase-2-cycles-issues-gates.md:102`, `.plans/phase-2-cycles-issues-gates.md:133`

5. The build review flow is incomplete. BuildCycles are defined as `building -> reviewing -> approved | rejected`, but no tool moves a cycle into `reviewing`. The feature lifecycle still depends on entering `build_review`, and `blueprint_start_build` conflicts with the state set by plan approval.
   - Refs: `.plans/phase-2-cycles-issues-gates.md:55`, `.plans/phase-2-cycles-issues-gates.md:74`, `.plans/phase-2-cycles-issues-gates.md:134`, `.plans/phase-2-cycles-issues-gates.md:213`

6. `blueprint_get_history` requires FU rework counts and AC failure-before-pass rates, but the schema only stores current FU and AC status. No status history or audit log exists to support those metrics.
   - Refs: `.plans/phase-1-core-mcp-server.md:70`, `.plans/phase-1-core-mcp-server.md:71`, `.plans/phase-4-skills-subagents.md:216`, `.plans/phase-4-skills-subagents.md:217`

### Medium

7. Lock ownership validation is underspecified. `blueprint_heartbeat({ lock_id })` must reject heartbeats from a different `agent_id`, but the tool input and plan do not define how caller identity is supplied.
   - Refs: `.plans/phase-3-parallel-merge.md:98`, `.plans/phase-3-parallel-merge.md:100`

8. MergePoint readiness is not integrated into the dependency engine. The plan says `merged_fu` becomes unblocked when a MergePoint is ready, but no storage or graph rule ties merge readiness to FU blocking.
   - Refs: `.plans/phase-3-parallel-merge.md:42`, `.plans/phase-3-parallel-merge.md:127`, `.plans/phase-3-parallel-merge.md:132`

9. AC-3.6.1 is non-testable as written because it allows two incompatible persistence models for the second FU in an `integration_conflict`: either store it in `description` or add a new `related_fu_id` field.
   - Refs: `.plans/phase-3-parallel-merge.md:183`

10. Phase 4 has internal mismatches: it calls the agent definitions YAML while assigning `.md` files, promises coordinator coverage from plan through done even though the coordinator starts from an active build cycle, and requires released locks in the Executor completion condition without including an explicit release step in the implementation loop.
   - Refs: `.plans/phase-4-skills-subagents.md:15`, `.plans/phase-4-skills-subagents.md:107`, `.plans/phase-4-skills-subagents.md:118`, `.plans/phase-4-skills-subagents.md:141`, `.plans/phase-4-skills-subagents.md:155`, `.plans/phase-4-skills-subagents.md:98`, `.plans/phase-4-skills-subagents.md:102`, `.plans/phase-3-parallel-merge.md:101`

## Suggested Fix Order

1. Fix phase ordering and dependencies in Phase 1 and Phase 2.
2. Normalize lifecycle and severity vocabularies.
3. Add missing persistence or move dependent work units to later phases.
4. Define history/audit storage before keeping analytics requirements.
5. Tighten underspecified Phase 3 and Phase 4 acceptance criteria.
