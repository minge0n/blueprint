# `.plans` Precision Audit — Round 2

- Generated: `2026-03-07 00:45:08`
- Scope: `.plans/00-index.md`, `.plans/anatomy.md`, and all phase files
- Goal: identify remaining concrete plan defects after the latest fixes

## Findings

### High

1. `wont_fix` is part of the Issue state model and is required by gates/skills, but no tool can set it.
   - `Issue.status` includes `wont_fix`, and both the plan gate and verify flow rely on that status.
   - The only mutation tool is `blueprint_resolve_issue(...)`, which only sets status to `resolved`.
   - Refs: `.plans/anatomy.md:110`, `.plans/anatomy.md:202`, `.plans/anatomy.md:293`, `.plans/anatomy.md:503`, `.plans/phase-2-cycles-issues-gates.md:192`, `.plans/phase-2-cycles-issues-gates.md:221`, `.plans/phase-4-skills-subagents.md:72`

2. `blueprint_update_ac` is internally inconsistent with the AcceptanceCriteria model.
   - `AcceptanceCriteria.verified_in` is defined as a build-cycle id.
   - The tool signature is `blueprint_update_ac(ac_id, status, evidence?)`, and Phase 1 says that optional argument sets `verified_in`.
   - The verify flow passes evidence text into that third argument, so the same parameter is being treated as both evidence and a build-cycle id.
   - Refs: `.plans/anatomy.md:80`, `.plans/anatomy.md:240`, `.plans/anatomy.md:491`, `.plans/phase-1-core-mcp-server.md:160`

3. `integration_conflict` still cannot be expressed through the canonical Issue model or published tool signature.
   - Phase 3 requires `related_fu_id` for `integration_conflict` issues.
   - The canonical Issue type and `blueprint_add_issue(...)` signature still have no `related_fu_id` field/parameter.
   - Refs: `.plans/anatomy.md:86`, `.plans/anatomy.md:289`, `.plans/phase-3-parallel-merge.md:186`, `.plans/phase-3-parallel-merge.md:195`

4. The worker startup sequence is still contradictory inside the spec.
   - Phase 4 says the build skill must use the exact 5-step startup from the spec: `resume -> checkpoint.next_fu -> open issues -> parallel_status -> get_available_work`.
   - The canonical recovery protocol in `anatomy.md` still defines a different 6-step sequence ending with `heartbeat` and `checkpoint`, and omits `get_available_work`.
   - Refs: `.plans/phase-4-skills-subagents.md:97`, `.plans/anatomy.md:314`, `.plans/anatomy.md:318`, `.plans/anatomy.md:319`, `.plans/anatomy.md:553`, `.plans/anatomy.md:557`

5. The coordinator and worker still both acquire work, which creates a double-dispatch conflict.
   - The coordinator loop acquires an FU with `blueprint_get_available_work(agent_id)` before spawning a worker.
   - The worker startup sequence also mandates `blueprint_get_available_work(agent_id)`.
   - A worker following the plan can grab a second FU instead of executing the FU the coordinator already assigned.
   - Refs: `.plans/anatomy.md:557`, `.plans/anatomy.md:685`, `.plans/anatomy.md:686`, `.plans/phase-4-skills-subagents.md:97`, `.plans/phase-4-skills-subagents.md:161`

6. The checkpoint/resume model is still single-agent, but the later workflow is multi-agent.
   - The `checkpoints` table is unique on `build_cycle_id`, so there is only one checkpoint row per build cycle.
   - `blueprint_resume({ agent_id? })` promises to return work relevant to that agent and "its checkpoint".
   - Phase 4 spawns multiple worker subagents in the same build cycle, and each worker is required to checkpoint after every FU.
   - One shared `next_fu`/`notes` record cannot represent per-agent progress without workers overwriting each other.
   - Refs: `.plans/anatomy.md:153`, `.plans/anatomy.md:156`, `.plans/phase-2-cycles-issues-gates.md:77`, `.plans/phase-2-cycles-issues-gates.md:130`, `.plans/phase-2-cycles-issues-gates.md:162`, `.plans/phase-4-skills-subagents.md:161`

7. WU-3.4 still violates file-ownership and parallel-safety rules.
   - The index says an agent must not modify files outside its ownership set.
   - WU-3.4 requires changing `getUnblockedFUs` behavior, but that logic lives in `src/graph/dependency.ts`, owned by WU-3.1.
   - It also requires `blueprint_get_available_work` to respect MergePoint blocking, but that logic lives in WU-3.2-owned files while WU-3.4 is marked parallel-safe with WU-3.2.
   - Refs: `.plans/00-index.md:87`, `.plans/00-index.md:89`, `.plans/phase-3-parallel-merge.md:38`, `.plans/phase-3-parallel-merge.md:71`, `.plans/phase-3-parallel-merge.md:119`, `.plans/phase-3-parallel-merge.md:142`, `.plans/phase-3-parallel-merge.md:144`

### Medium

8. `blueprint_get_parallel_status` is still called with the wrong signature in the coordinator flow.
   - The tool spec and Phase 3 ACs require `feature_id`.
   - The coordinator flow/AC calls `blueprint_get_parallel_status()` with no argument.
   - Refs: `.plans/anatomy.md:277`, `.plans/anatomy.md:683`, `.plans/phase-3-parallel-merge.md:166`, `.plans/phase-4-skills-subagents.md:160`

9. `blueprint_check_merge_ready` is also called with the wrong signature in the coordinator flow.
   - The tool spec requires `merge_point_id`.
   - The coordinator flow/AC invokes it generically for pending MergePoints with no id argument.
   - Refs: `.plans/anatomy.md:284`, `.plans/anatomy.md:688`, `.plans/phase-3-parallel-merge.md:141`, `.plans/phase-4-skills-subagents.md:163`

10. `blueprint_submit_for_review` is still under-specified on the server side.
    - The canonical tool rule says it should only be called when all FUs are passed and all locks are released.
    - WU-2.2b only requires the BuildCycle to be in `building` status and to have no active WorkLocks.
    - As written, the server could admit an incomplete build into review.
    - Refs: `.plans/anatomy.md:258`, `.plans/anatomy.md:259`, `.plans/phase-2-cycles-issues-gates.md:104`, `.plans/phase-2-cycles-issues-gates.md:106`, `.plans/phase-4-skills-subagents.md:164`

11. The FU status model still has required states/transitions that no tool actually drives.
    - The model includes `failed`, and the history tool requires counting FU transitions from `passed` back to `in_progress` or `failed`.
    - No current tool/AC defines how an FU becomes `failed`, or how a previously `passed` FU is reopened.
    - Refs: `.plans/anatomy.md:64`, `.plans/anatomy.md:78`, `.plans/phase-3-parallel-merge.md:82`, `.plans/phase-3-parallel-merge.md:85`, `.plans/phase-4-skills-subagents.md:223`

## Suggested Fix Order

1. Fix the hard model/tool mismatches: `wont_fix`, `blueprint_update_ac`, `related_fu_id`, and the checkpoint-per-agent problem.
2. Resolve execution-flow contradictions: worker startup sequence, coordinator vs worker work acquisition, and `submit_for_review` validation.
3. Repair the Phase 3 ownership/signature issues so the parallel plan can actually be implemented under its own rules.
