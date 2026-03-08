# Phase 4 — Skills + Subagents

> Persona definitions, subagent configurations, coordinator loop,
> export and history analysis. This phase makes Blueprint self-driving.

## Phase Entry Criteria
- Phase 3 complete: all `must` ACs pass
- Parallel execution works: atomic lock acquisition, heartbeat, MergePoints
- Full issue taxonomy operational including integration categories
- All approval gates enforced server-side

## Phase Exit Criteria
- Three skill files define complete behavioral rules for plan/verify/build personas
- Three subagent Markdown definitions are valid and reference correct tools + skills
- Coordinator loop can drive a feature from active build cycle through review to done
- `blueprint_export` produces a complete Markdown lifecycle report
- `blueprint_get_history` returns cycle counts, issue recurrence, AC failure rates

---

## WU-4.1: Plan Skill File

**`[PARALLEL-SAFE]` — Parallel with WU-4.2, WU-4.3, WU-4.6, WU-4.7**

### Description
Write the Architect skill file. Defines the persona, decomposition rules,
plan review behavior, issue filing rules, and completion conditions.
Must reference the exact MCP tool names and follow the spec's behavioral rules.

### File Ownership
```
.blueprint/skills/plan.md
```

### Acceptance Criteria

| ID | Description | Severity |
|----|-------------|----------|
| AC-4.1.1 | Skill file defines identity as "The Architect" with the spec's exact behavioral description | must |
| AC-4.1.2 | Activation section specifies: operates when Feature status = `draft` or `plan_review` | must |
| AC-4.1.3 | Decomposition rules cover: single-concern FUs, three-level ACs (happy/failure/edge), severity honesty, concrete testability, out_of_scope requirement, dependency mapping | must |
| AC-4.1.4 | Plan review behavior lists all 7 check categories from the spec | must |
| AC-4.1.5 | Issue filing rules require `fu_id` on every issue and `ac_id` when applicable | must |
| AC-4.1.6 | Completion condition: `blueprint_approve_plan({ plan_cycle_id })` succeeds | must |
| AC-4.1.7 | "What You Never Do" section matches the spec's 5 prohibitions | must |
| AC-4.1.8 | Startup sequence mandates `blueprint_resume()` as first call | must |

---

## WU-4.2: Verify Skill File

**`[PARALLEL-SAFE]` — Parallel with WU-4.1, WU-4.3, WU-4.6, WU-4.7**

### Description
Write the Skeptic skill file. Defines both plan verification and build verification
behaviors, issue filing standards, and the "immune to pressure" persona.

### File Ownership
```
.blueprint/skills/verify.md
```

### Acceptance Criteria

| ID | Description | Severity |
|----|-------------|----------|
| AC-4.2.1 | Skill file defines identity as "The Skeptic" with the spec's exact behavioral description | must |
| AC-4.2.2 | Plan verification section: checks testability, failure modes, scope, dependencies for each FU | must |
| AC-4.2.3 | Plan verification includes mandatory security pass (user input handling, credential storage) | must |
| AC-4.2.4 | Build verification section: reads `test_evidence` for each FU, validates each `must` AC | must |
| AC-4.2.5 | Build verification includes integration checks for MergePoints (interface compatibility, shared state) | must |
| AC-4.2.6 | Carry-over check: previous cycle's open `critical`/`major` issues must be resolved; only `minor`/`nitpick` issues may be marked `wont_fix` | must |
| AC-4.2.7 | Issue filing rules: code location required for implementation issues, no duplicates, no suppression | must |
| AC-4.2.8 | "What You Never Do" section matches the spec's 5 prohibitions | must |
| AC-4.2.9 | Startup sequence for both activation modes mandates `blueprint_resume()` first | must |

---

## WU-4.3: Build Skill File

**`[PARALLEL-SAFE]` — Parallel with WU-4.1, WU-4.2, WU-4.6, WU-4.7**

### Description
Write the Executor skill file. Defines the implementation loop, checkpoint discipline,
parallel execution rules, evidence requirements, and problem-handling procedures.

### File Ownership
```
.blueprint/skills/build.md
```

### Acceptance Criteria

| ID | Description | Severity |
|----|-------------|----------|
| AC-4.3.1 | Skill file defines identity as "The Executor" with the spec's exact behavioral description | must |
| AC-4.3.2 | Startup sequence is the 5-step mandatory sequence: `blueprint_resume({ agent_id })` → read `checkpoint.next_fu` + `current_lock` → open issues → parallel_status → acquire FU (use pre-assigned `fu_id` + `lock_id` from coordinator if present, or existing `lock_id` from resume if resuming, or call `blueprint_get_available_work({ agent_id })` only if neither) | must |
| AC-4.3.3 | Implementation loop covers all 8 required actions: read FU → implement → write tests → run tests → `blueprint_complete_fu({ build_cycle_id, fu_id, agent_id, evidence })` → `blueprint_checkpoint({ build_cycle_id, agent_id, completed_fu, next_fu, notes })` → `blueprint_release_lock({ lock_id, agent_id })` → heartbeat during steps 1–5 every 60s while the lock is held via `blueprint_heartbeat({ lock_id, agent_id })` | must |
| AC-4.3.4 | Problem handling: plan defect → file issue + continue; impossible AC → file issue + `blueprint_fail_fu` + release lock; security gap → implement safe default + file issue | must |
| AC-4.3.5 | Parallel execution rules: only work on FUs assigned directly by `get_available_work` or pre-assigned by coordinator from that call; never touch other agent's files; wait for locked dependencies; heartbeat every 60s | must |
| AC-4.3.6 | Evidence requirements: test names, assertions, actual outputs, pass/fail per AC — "it works" is explicitly rejected | must |
| AC-4.3.7 | Completion condition: all assigned FUs `passed`, all WorkLocks released, does NOT call approve_build | must |
| AC-4.3.8 | "What You Never Do" section matches the spec's 6 prohibitions | must |

---

## WU-4.4: Subagent Markdown Definitions

**`[SEQUENTIAL]` after WU-4.1 + WU-4.2 + WU-4.3**

### Description
Write the three subagent definitions as Markdown files: coordinator, worker, skeptic.
Each references the correct tools and skills. These are the configuration
files that agent frameworks use to spawn specialized subagents.
Note: the spec calls these "YAML" but the actual file format is Markdown with
YAML frontmatter, matching the `.md` extension.
The plan skill is intended for the primary planning agent/session, so no
separate planner subagent definition is required here.

### File Ownership
```
.claude/agents/coordinator.md
.claude/agents/worker.md
.claude/agents/skeptic.md
```

### Acceptance Criteria

| ID | Description | Severity |
|----|-------------|----------|
| AC-4.4.1 | `coordinator.md` lists tools: `Agent(worker)`, `Agent(skeptic)`, `blueprint_resume`, `blueprint_get_available_work`, `blueprint_get_parallel_status`, `blueprint_start_build`, `blueprint_submit_for_review`, `blueprint_approve_build`, `blueprint_reject_build`, `blueprint_add_merge_point`, `blueprint_check_merge_ready` | must |
| AC-4.4.2 | `worker.md` lists tools: `Read`, `Write`, `Edit`, `Bash`, `blueprint_resume`, `blueprint_checkpoint`, `blueprint_complete_fu`, `blueprint_fail_fu`, `blueprint_heartbeat`, `blueprint_add_issue`, `blueprint_update_ac`, `blueprint_get_available_work`, `blueprint_release_lock`, `blueprint_get_parallel_status` | must |
| AC-4.4.3 | `worker.md` references skill: `.blueprint/skills/build.md` | must |
| AC-4.4.4 | `skeptic.md` lists tools: `Read`, `Grep`, `Bash`, `blueprint_resume`, `blueprint_get_context`, `blueprint_add_issue`, `blueprint_fail_fu`, `blueprint_resolve_issue`, `blueprint_list_issues`, `blueprint_update_ac`, `blueprint_approve_plan`, `blueprint_reject_plan`, `blueprint_approve_build`, `blueprint_reject_build` | must |
| AC-4.4.5 | `skeptic.md` references skill: `.blueprint/skills/verify.md` | must |
| AC-4.4.6 | Each definition has YAML frontmatter with `name` and `description` fields matching the spec | must |

---

## WU-4.5: Coordinator Loop

**`[SEQUENTIAL]` after WU-4.4 + WU-3.5 (needs parallel status)**

### Description
Implement the coordinator execution loop that drives a feature from approved plan
to completed build. If the feature is in `building` with no active BuildCycle yet,
the coordinator starts the initial build iteration. It then spawns workers for
available FUs, monitors progress, submits for review via
`blueprint_submit_for_review`, triggers skeptic review when all FUs pass, and
handles rejection cycles. The coordinator does NOT manage the plan phase — it
assumes an approved plan exists.

### File Ownership
```
src/coordinator/loop.ts
src/coordinator/types.ts
```

### Acceptance Criteria

| ID | Description | Severity |
|----|-------------|----------|
| AC-4.5.1 | Coordinator starts with `blueprint_resume()` to find active feature + build cycle | must |
| AC-4.5.2 | If the feature is in `building` and no active BuildCycle exists yet, coordinator calls `blueprint_start_build({ feature_id, agent_id: coordinator_agent_id })` before dispatching workers | must |
| AC-4.5.3 | Calls `blueprint_get_parallel_status({ feature_id })` to assess current state | must |
| AC-4.5.4 | For each idle agent slot: calls `blueprint_get_available_work({ agent_id })` and spawns a worker subagent, passing the pre-assigned `fu_id`, `lock_id`, and `build_cycle_id` — worker does NOT call `get_available_work` again | must |
| AC-4.5.5 | Waits for all worker results before proceeding | must |
| AC-4.5.6 | For each pending MergePoint: calls `blueprint_check_merge_ready({ merge_point_id })` after workers complete | must |
| AC-4.5.7 | When all FUs passed: calls `blueprint_submit_for_review({ build_cycle_id })` to transition BuildCycle to `reviewing`, then spawns skeptic subagent for build review | must |
| AC-4.5.8 | If skeptic rejects: calls `blueprint_start_build({ feature_id, agent_id: coordinator_agent_id })` to create a new BuildCycle iteration, then returns to status/dispatch loop | must |
| AC-4.5.9 | If skeptic approves: feature transitions to `done` | must |
| AC-4.5.10 | Coordinator handles worker crashes gracefully — expired locks are reassigned on next loop iteration | should |

---

## WU-4.6: blueprint_export (Markdown Report)

**`[PARALLEL-SAFE]` — Parallel with WU-4.1, WU-4.2, WU-4.3**

### Description
Implement the export tool that generates a complete Markdown lifecycle report
for a feature. Covers all cycles, issues, AC results, and timing.

### File Ownership
```
src/tools/export.ts
src/export/markdown.ts     (report generation logic)
```

### Acceptance Criteria

| ID | Description | Severity |
|----|-------------|----------|
| AC-4.6.1 | `blueprint_export({ feature_id })` returns a Markdown string and writes to `~/.blueprint/exports/{feature_id}.md` | must |
| AC-4.6.2 | Report includes: feature metadata (title, scope, out_of_scope, priority, status) | must |
| AC-4.6.3 | Report includes: all PlanCycles with iteration count and outcome | must |
| AC-4.6.4 | Report includes: all BuildCycles with iteration count, initiating agent, per-agent session count, outcome | must |
| AC-4.6.5 | Report includes: all FUs with their AC pass/fail status | must |
| AC-4.6.6 | Report includes: all Issues grouped by cycle, with resolution status | must |
| AC-4.6.7 | Report includes: summary statistics — total cycles, total issues, issues by category, issues by severity | must |

---

## WU-4.7: blueprint_get_history (Recurrence Analysis)

**`[PARALLEL-SAFE]` — Parallel with WU-4.1, WU-4.2, WU-4.3 · Depends on WU-2.6 + WU-1.6 (status audit log)**

### Description
Implement the history analysis tool. Provides insights into development patterns:
which FU categories produce rework, which issue types recur, AC failure rates.
Relies on the `status_audit_log` table (WU-1.6) for rework counts and
failure-before-pass rates that cannot be derived from current-status-only columns.

### File Ownership
```
src/tools/history.ts
src/analysis/recurrence.ts   (analysis logic)
```

### Acceptance Criteria

| ID | Description | Severity |
|----|-------------|----------|
| AC-4.7.1 | `blueprint_get_history({ feature_id })` returns structured analysis data | must |
| AC-4.7.2 | Includes: total plan cycle count and build cycle count | must |
| AC-4.7.3 | Includes: issue recurrence — issues that were filed, resolved, then refiled across cycles (same fu_id + category) | must |
| AC-4.7.4 | Includes: AC failure rates by type (`functional`, `performance`, `security`, `edge_case`) — percentage of ACs that failed at least once before passing | must |
| AC-4.7.5 | Includes: FU rework count — how many times each FU went from `passed` back to `in_progress` or `failed` | must |
| AC-4.7.6 | Includes: issue category distribution — count per category across all cycles | must |
| AC-4.7.7 | Includes: average cycles to approval (plan and build separately) | should |
