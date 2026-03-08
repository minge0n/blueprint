# `.plans` Precision Audit

- Generated: `2026-03-06 15:56:36`
- Scope: `.plans/00-index.md`, `.plans/anatomy.md`, and all phase files
- Goal: identify remaining concrete planning defects after the latest edits

## Findings

### High

1. Duplicate migration number `003` is assigned twice, making migration ordering ambiguous.
   - `src/db/migrations/003-work-locks.ts` is owned by Phase 1, while `src/db/migrations/003-plan-cycles.ts` is owned by Phase 2.
   - Refs: `.plans/phase-1-core-mcp-server.md:204`, `.plans/phase-2-cycles-issues-gates.md:35`

2. Phase 2 build progress is still not executable as planned.
   - `blueprint_complete_fu` requires the FU to already be `in_progress`, but no Phase 2 work unit sets that status.
   - The first declared mechanism that sets FU status to `in_progress` is `blueprint_get_available_work` in Phase 3.
   - Refs: `.plans/phase-2-cycles-issues-gates.md:132`, `.plans/phase-2-cycles-issues-gates.md:134`, `.plans/phase-3-parallel-merge.md:79`, `.plans/phase-3-parallel-merge.md:85`

3. The status audit log schema cannot record some status changes the later phases require it to record.
   - WU-1.6 restricts `entity_type` to `feature`, `function_unit`, and `acceptance_criteria`.
   - WU-2.2b requires logging a BuildCycle status transition, which is outside that enum.
   - Refs: `.plans/phase-1-core-mcp-server.md:185`, `.plans/phase-2-cycles-issues-gates.md:104`, `.plans/phase-2-cycles-issues-gates.md:107`

4. `blueprint_heartbeat` still has conflicting signatures across the plan.
   - `anatomy.md` defines and demonstrates `blueprint_heartbeat(lock_id)`.
   - Phase 3 requires `blueprint_heartbeat({ lock_id, agent_id })` for lock ownership validation.
   - An implementation or skill following `anatomy.md` will call the Phase 3 tool incorrectly.
   - Refs: `.plans/anatomy.md:268`, `.plans/anatomy.md:314`, `.plans/anatomy.md:569`, `.plans/phase-3-parallel-merge.md:108`

5. The worker subagent still cannot follow the required build-skill startup sequence.
   - The build skill requires reading `parallel_status` before acquiring work.
   - `worker.md` does not include `blueprint_get_parallel_status` in its allowed tools.
   - Refs: `.plans/phase-4-skills-subagents.md:97`, `.plans/phase-4-skills-subagents.md:130`, `.plans/anatomy.md:552`, `.plans/anatomy.md:648`

6. The skeptic subagent still cannot follow its own required startup sequence.
   - The verify skill mandates `blueprint_resume()` first for both plan and build verification.
   - `skeptic.md` does not include `blueprint_resume` in its tool list.
   - Refs: `.plans/phase-4-skills-subagents.md:75`, `.plans/phase-4-skills-subagents.md:132`, `.plans/anatomy.md:451`, `.plans/anatomy.md:480`, `.plans/anatomy.md:663`

7. The build rejection loop remains incomplete.
   - The coordinator says a rejection increments the BuildCycle iteration and resumes work.
   - The current cycle is set to `rejected`, and the only defined auto-increment behavior is on `blueprint_start_build`.
   - The coordinator tool list does not include `blueprint_start_build`, so it has no defined way to create the next build cycle after rejection.
   - Refs: `.plans/phase-4-skills-subagents.md:129`, `.plans/phase-4-skills-subagents.md:165`, `.plans/phase-2-cycles-issues-gates.md:78`, `.plans/phase-2-cycles-issues-gates.md:80`, `.plans/phase-2-cycles-issues-gates.md:252`, `.plans/anatomy.md:682`

8. `anatomy.md` still specifies an impossible plan-approval rule.
   - The gate requires all open `should` issues to be resolved or `wont_fix`.
   - Issue severities are defined as `critical`, `major`, `minor`, `nitpick`; there is no `should` issue severity.
   - Refs: `.plans/anatomy.md:104`, `.plans/anatomy.md:198`, `.plans/anatomy.md:202`, `.plans/phase-2-cycles-issues-gates.md:221`

9. WU-3.6 cannot satisfy its own schema change within its declared ownership.
   - AC-3.6.1 says the `issues` table gains `related_fu_id`.
   - WU-3.6 only owns helper/query files, not a migration or the Issue entity definition.
   - That violates the file-ownership convention for parallel work and leaves the schema update unowned.
   - Refs: `.plans/00-index.md:83`, `.plans/00-index.md:88`, `.plans/phase-3-parallel-merge.md:184`, `.plans/phase-3-parallel-merge.md:194`

### Medium

10. The parallel execution map in the index still schedules dependent work units as if they were parallel.
    - Phase 2 Group C lists `WU-2.2d`, `WU-2.5`, and `WU-2.6` as parallel.
    - But WU-2.6 explicitly depends on WU-2.2d.
    - Refs: `.plans/00-index.md:68`, `.plans/00-index.md:69`, `.plans/phase-2-cycles-issues-gates.md:259`

11. `blueprint_checkpoint` is required to write a status-audit entry even though it does not change status.
    - WU-2.2c says both checkpoint and FU completion record `logStatusChange` audit entries.
    - The audit log is defined for status changes, but checkpoint ACs only describe checkpoint upsert behavior.
    - Refs: `.plans/phase-2-cycles-issues-gates.md:130`, `.plans/phase-2-cycles-issues-gates.md:135`, `.plans/phase-1-core-mcp-server.md:169`, `.plans/phase-1-core-mcp-server.md:186`

12. `anatomy.md` still describes stale phase placement for major tools.
    - It puts `blueprint_resume`, `blueprint_checkpoint`, and `blueprint_complete_fu` in Phase 1.
    - It puts `blueprint_get_available_work` in Phase 2.
    - The index and phase files now place those in Phase 2 and Phase 3 respectively.
    - Refs: `.plans/anatomy.md:720`, `.plans/anatomy.md:722`, `.plans/anatomy.md:729`, `.plans/00-index.md:28`, `.plans/00-index.md:29`, `.plans/00-index.md:39`

13. The canonical build-skill text in `anatomy.md` still omits explicit lock release after FU completion.
    - The implementation loop goes from `complete_fu` to `checkpoint` to heartbeat, with no release step.
    - The completion condition still requires all WorkLocks released.
    - Review submission rejects any active WorkLock.
    - Refs: `.plans/anatomy.md:566`, `.plans/anatomy.md:567`, `.plans/anatomy.md:569`, `.plans/anatomy.md:608`, `.plans/phase-2-cycles-issues-gates.md:106`, `.plans/phase-4-skills-subagents.md:98`

14. The success criteria still ask for analytics on "which FU categories produce the most rework," but the data model defines no FU category field.
    - FunctionUnits have `id`, `feature_id`, `title`, `description`, dependencies, status, assignment, and evidence, but no category.
    - Refs: `.plans/anatomy.md:52`, `.plans/anatomy.md:67`, `.plans/anatomy.md:760`, `.plans/anatomy.md:761`

### Low

15. Phase 1 still contains stale references to nonexistent `WU-1.8`.
    - WU-1.4 and WU-1.5 say they are parallel with `WU-1.8`, but Phase 1 now ends at WU-1.7.
    - Refs: `.plans/phase-1-core-mcp-server.md:110`, `.plans/phase-1-core-mcp-server.md:137`

## Suggested Fix Order

1. Resolve the executable blockers: migration numbering, Phase 2 FU state progression, audit-log entity coverage, and the rejection-loop restart path.
2. Unify tool contracts across `anatomy.md`, skill text, and phase files, especially `blueprint_heartbeat`, `blueprint_submit_for_review`, and worker/skeptic tool access.
3. Fix ownership and scheduling metadata so the phase/index documents can actually guide parallel implementation safely.
4. Clean up stale `anatomy.md` sections so the spec and phased plan stop disagreeing about lifecycle, phases, and required steps.
