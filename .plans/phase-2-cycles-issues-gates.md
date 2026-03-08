# Phase 2 — Cycles, Issues, Gates

> State machines for plan and build review. Issue tracking with category taxonomy.
> Server-enforced approval gates — no client can bypass them.
> Also includes `blueprint_resume`, `blueprint_checkpoint`, and `blueprint_complete_fu`
> which depend on cycle and checkpoint tables introduced here.

## Phase Entry Criteria
- Phase 1 complete: all `must` ACs pass
- Feature, FunctionUnit, AcceptanceCriteria entities operational
- MCP server accepting tool calls
- Status audit log operational

## Phase Exit Criteria
- PlanCycle and BuildCycle state machines enforce valid transitions only
- Issues can be created, queried, and resolved with full category/severity taxonomy
- `blueprint_approve_plan` rejects when gate rules are violated (server-side)
- `blueprint_approve_build` rejects when gate rules are violated (server-side)
- Feature status transitions automatically based on cycle outcomes
- `blueprint_resume` returns full context for any agent session
- `blueprint_checkpoint` and `blueprint_complete_fu` track build progress

---

## WU-2.1: PlanCycle Entity + State Machine

**`[PARALLEL-SAFE]` — Parallel with WU-2.2, WU-2.3**

### Description
Create the PlanCycle entity with its state machine: `drafting → reviewing → approved | rejected`.
Implement `blueprint_start_plan_review`. Store plan snapshots at review time.

### File Ownership
```
src/db/migrations/004-plan-cycles.ts
src/entities/plan-cycle.ts
src/tools/plan-cycle.ts
src/db/queries/plan-cycle.ts
```

### Acceptance Criteria

| ID | Description | Severity |
|----|-------------|----------|
| AC-2.1.1 | `plan_cycles` table: `id TEXT PK`, `feature_id TEXT FK`, `iteration INTEGER NOT NULL`, `plan_snapshot TEXT` (JSON), `status TEXT NOT NULL DEFAULT 'drafting'` | must |
| AC-2.1.2 | `blueprint_start_plan_review({ feature_id })` creates a new PlanCycle, snapshots all FUs + ACs as JSON, sets status to `reviewing` | must |
| AC-2.1.3 | Starting a plan review when feature status is not `draft` and not `plan_review` returns an error | must |
| AC-2.1.4 | Feature status transitions to `plan_review` when first PlanCycle enters `reviewing` | must |
| AC-2.1.5 | `iteration` auto-increments per feature (first review = 1, rejection + re-review = 2, etc.) | must |
| AC-2.1.6 | Only one PlanCycle per feature can be in `drafting` or `reviewing` status at a time | must |
| AC-2.1.7 | Plan snapshot is stored in `~/.blueprint/snapshots/` as `{plan_cycle_id}.json` | should |

---

## WU-2.2: BuildCycle Entity + State Machine

**`[PARALLEL-SAFE]` — Parallel with WU-2.1, WU-2.3**

### Description
Create the BuildCycle entity with its state machine: `building → reviewing → approved | rejected`.
Implement `blueprint_start_build`. Track per-agent session logs for context compact recovery.

### File Ownership
```
src/db/migrations/005-build-cycles.ts
src/entities/build-cycle.ts
src/tools/build-cycle.ts
src/db/queries/build-cycle.ts
```

### Acceptance Criteria

| ID | Description | Severity |
|----|-------------|----------|
| AC-2.2.1 | `build_cycles` table: `id TEXT PK`, `feature_id TEXT FK`, `iteration INTEGER NOT NULL`, `agent_id TEXT NOT NULL` (the agent that opened the cycle), `status TEXT NOT NULL DEFAULT 'building'` | must |
| AC-2.2.2 | `session_logs` table: `id TEXT PK`, `build_cycle_id TEXT FK`, `agent_id TEXT NOT NULL`, `session_id TEXT NOT NULL` (generated server-side), `started_at TEXT NOT NULL`, `ended_at TEXT`, `end_reason TEXT` (values: `compact`, `done`, `error`, null) | must |
| AC-2.2.3 | `checkpoints` table: `id TEXT PK`, `build_cycle_id TEXT FK`, `agent_id TEXT NOT NULL`, `completed_fus TEXT NOT NULL` (JSON array), `next_fu TEXT`, `notes TEXT`, UNIQUE constraint on `(build_cycle_id, agent_id)` — one checkpoint per agent per build cycle | must |
| AC-2.2.4 | `blueprint_start_build({ feature_id, agent_id })` creates a BuildCycle for the initial build iteration after plan approval, or for a retry after rejection, records the provided `agent_id` as the cycle opener, and creates an initial session log entry for that same agent. Feature must already be in `building` status (set by plan approval) — does NOT set feature status itself | must |
| AC-2.2.5 | Starting a build when feature status is not `building` returns an error with message: `"Feature must be in 'building' status. Current: {status}"` | must |
| AC-2.2.6 | `iteration` auto-increments per feature | must |
| AC-2.2.7 | When a session ends, the current open session row is closed by the runtime/server integration: watchdog expiry records `compact`, orderly exit records `done`, and abnormal termination records `error`; each closure writes `ended_at` and `end_reason` on that existing row | must |
| AC-2.2.8 | Only one BuildCycle per feature can be in `building` or `reviewing` status at a time; `blueprint_start_build` rejects attempts to create another active cycle | must |
| AC-2.2.9 | At most one `session_logs` row per `(build_cycle_id, agent_id)` may be open at a time (`ended_at IS NULL`); resume/start logic must reuse that row instead of opening a second active session | must |

---

## WU-2.2b: blueprint_submit_for_review Tool

**`[SEQUENTIAL]` after WU-2.2**

### Description
Implement the tool that transitions a BuildCycle from `building` to `reviewing`
and the Feature from `building` to `build_review`. Without this tool, there is
no way to enter the `reviewing` state — the build review flow is incomplete.

### File Ownership
```
src/tools/build-review.ts
src/db/queries/build-review.ts
```

### Acceptance Criteria

| ID | Description | Severity |
|----|-------------|----------|
| AC-2.2b.1 | `blueprint_submit_for_review({ build_cycle_id })` sets BuildCycle status to `reviewing` and Feature status to `build_review` | must |
| AC-2.2b.2 | Rejects if BuildCycle is not in `building` status | must |
| AC-2.2b.3 | Rejects if any active WorkLock exists on FUs in this build cycle — all agents must release locks before review | must |
| AC-2.2b.4 | Rejects if any FunctionUnit in this feature has status other than `passed` — all FUs must be complete before review | must |
| AC-2.2b.5 | Records a `logStatusChange` audit entry for both the BuildCycle and Feature transitions | must |

---

## WU-2.2c: blueprint_checkpoint + blueprint_complete_fu Tools

**`[SEQUENTIAL]` after WU-2.2 (needs build_cycles + checkpoints tables)**

### Description
Implement checkpoint and FU completion tools. These are the core progress-tracking
mechanisms that enable context compact recovery. Moved from Phase 1 because they
depend on the `build_cycles` and `checkpoints` tables created in WU-2.2.

### File Ownership
```
src/tools/checkpoint.ts
src/db/queries/checkpoint.ts
```

### Acceptance Criteria

| ID | Description | Severity |
|----|-------------|----------|
| AC-2.2c.1 | `blueprint_checkpoint({ build_cycle_id, agent_id, completed_fu, next_fu, notes })` upserts a checkpoint record for the given agent within the build cycle | must |
| AC-2.2c.2 | Checkpoint stores `completed_fus` as an accumulated array (appends, does not replace) | must |
| AC-2.2c.3 | `blueprint_complete_fu({ build_cycle_id, fu_id, agent_id, evidence })` sets FU status to `passed`, stores `test_evidence`, and clears any previous `failure_reason` | must |
| AC-2.2c.4 | `blueprint_complete_fu` with empty or null `evidence` returns an error — evidence is mandatory | must |
| AC-2.2c.5 | Completing a FU that is not `pending` or `in_progress` returns an error — FU must be in a workable state (Phase 3 introduces `get_available_work` which sets `in_progress`; in Phase 2 single-agent mode, FUs start as `pending`) | must |
| AC-2.2c.6 | `blueprint_complete_fu` records a `logStatusChange` audit entry when changing FU status. `blueprint_checkpoint` does not change status and does not write audit entries | must |
| AC-2.2c.7 | Checkpoint is queryable by `blueprint_resume` for recovery | must |
| AC-2.2c.8 | `blueprint_fail_fu({ fu_id, reason })` sets FU status to `failed`, stores `failure_reason`, and records a `logStatusChange` audit entry. Only valid when FU is `in_progress` or `passed`. This enables the verify skill to mark FUs as failed; `blueprint_reject_build` later resets affected FUs to `pending` for the next iteration | must |
| AC-2.2c.9 | `blueprint_complete_fu` rejects unless `build_cycle_id` is the current active BuildCycle for the FU's feature and the FU belongs to that cycle's feature | must |
| AC-2.2c.10 | If an active WorkLock exists for the FU, `blueprint_complete_fu` requires that lock to be owned by the provided `agent_id`; otherwise it returns an ownership error | must |

---

## WU-2.2d: blueprint_resume Tool

**`[SEQUENTIAL]` after WU-2.2c + WU-2.3 (needs cycles, checkpoints, issues)**

### Description
Implement the `blueprint_resume` tool — the most critical tool in the system.
Returns the full context an agent needs to resume work after a context compact
or fresh session start. Moved from Phase 1 because its response includes cycles,
checkpoints, issues, and parallel agent status that only exist from Phase 2 onward.

### File Ownership
```
src/tools/resume.ts
src/db/queries/resume.ts
```

### Acceptance Criteria

| ID | Description | Severity |
|----|-------------|----------|
| AC-2.2d.1 | `blueprint_resume({ agent_id? })` returns: active feature, current cycle (if any), checkpoint (if any), current lock (if any), open issues (if any), next FU to work on, parallel agent status, session warnings | must |
| AC-2.2d.2 | If no active feature exists, returns `{ active_feature: null }` with no error | must |
| AC-2.2d.3 | If `agent_id` is provided, returns only work relevant to that agent (its locked FUs including `lock_id`, its per-agent checkpoint) | must |
| AC-2.2d.4 | Response includes `session_warnings` array — e.g., "WorkLock expired during last session" if applicable | must |
| AC-2.2d.5 | Returns open issues sorted by severity (critical first) | should |
| AC-2.2d.6 | During an active BuildCycle, `blueprint_resume({ agent_id })` ensures a session log entry exists for that agent's current session, generating `session_id` server-side and reusing the single already-open row (`ended_at IS NULL`) if present rather than creating duplicates | must |

---

## WU-2.3: Issue Entity + CRUD Tools

**`[PARALLEL-SAFE]` — Parallel with WU-2.1, WU-2.2**

### Description
Full Issue entity with the complete category and severity taxonomy from the spec.
Implement `blueprint_add_issue`, `blueprint_resolve_issue`, `blueprint_list_issues`.
Include `related_fu_id` from the start so integration issues do not require a later
schema change.

### File Ownership
```
src/db/migrations/006-issues.ts
src/entities/issue.ts
src/tools/issue.ts
src/db/queries/issue.ts
```

### Acceptance Criteria

| ID | Description | Severity |
|----|-------------|----------|
| AC-2.3.1 | `issues` table matches the spec's Issue type: `id`, `parent_type`, `parent_id`, `fu_id`, `ac_id`, `related_fu_id`, `category`, `severity`, `title`, `description`, `suggested_fix`, `status`, `resolved_in`, `resolution_note` | must |
| AC-2.3.2 | `category` validates against the full enum: `missing_case`, `wrong_assumption`, `scope_creep`, `ambiguity`, `dependency_gap`, `security_gap`, `performance_gap`, `implementation`, `integration_conflict`, `race_condition`, `interface_mismatch` | must |
| AC-2.3.3 | `severity` validates against: `critical`, `major`, `minor`, `nitpick` | must |
| AC-2.3.4 | `blueprint_add_issue` requires `fu_id` — rejects issues without a specific FU reference | must |
| AC-2.3.5 | `blueprint_resolve_issue({ issue_id, status, resolved_in, resolution_note })` sets issue status to the given `status` which must be `resolved` or `wont_fix` — rejects other values | must |
| AC-2.3.6 | `blueprint_list_issues({ feature_id?, status?, severity?, category? })` supports filtering by any combination; `category` accepts either a single category or an array | must |
| AC-2.3.7 | Issues with `status: 'open'` and `severity: 'critical'` are returned first in list queries (sorted by severity) | should |

---

## WU-2.4: Plan Approval Gate (Server-Enforced)

**`[SEQUENTIAL]` after WU-2.1 + WU-2.3**

### Description
Implement `blueprint_approve_plan` and `blueprint_reject_plan` with server-side
gate enforcement. The server MUST reject approval attempts that violate the rules.
No client-side honor system.

### File Ownership
```
src/tools/plan-gate.ts
src/gates/plan.ts          (gate rule logic, pure functions)
```

### Acceptance Criteria

| ID | Description | Severity |
|----|-------------|----------|
| AC-2.4.1 | `blueprint_approve_plan({ plan_cycle_id })` checks all gate rules before approving | must |
| AC-2.4.2 | Gate rejects if any `critical` issue is open on this PlanCycle | must |
| AC-2.4.3 | Gate rejects if any FunctionUnit has zero `must` AcceptanceCriteria | must |
| AC-2.4.4 | Gate rejects if Feature `out_of_scope` is empty | must |
| AC-2.4.5 | Gate rejects if any `major`-severity issue is `open` (must be `resolved` or `wont_fix`) | must |
| AC-2.4.6 | On approval: PlanCycle status → `approved`, Feature status → `building` (ready for build) | must |
| AC-2.4.7 | `blueprint_reject_plan({ plan_cycle_id })` sets status to `rejected`, Feature stays in `plan_review` | must |
| AC-2.4.8 | Rejection error response includes the list of failing gate conditions | should |

---

## WU-2.5: Build Approval Gate (Server-Enforced)

**`[SEQUENTIAL]` after WU-2.2b + WU-2.3**

### Description
Implement `blueprint_approve_build` and `blueprint_reject_build` with server-side
gate enforcement.

### File Ownership
```
src/tools/build-gate.ts
src/gates/build.ts         (gate rule logic, pure functions)
```

### Acceptance Criteria

| ID | Description | Severity |
|----|-------------|----------|
| AC-2.5.1 | `blueprint_approve_build({ build_cycle_id })` checks all gate rules before approving | must |
| AC-2.5.2 | Gate rejects if any FunctionUnit status ≠ `passed` | must |
| AC-2.5.3 | Gate rejects if any `critical` or `major` issue is not `resolved` | must |
| AC-2.5.4 | Gate rejects if any `must` AcceptanceCriteria status ≠ `passed` | must |
| AC-2.5.5 | Gate rejects if any active WorkLock remains on FUs in this cycle | must |
| AC-2.5.6 | On approval: BuildCycle status → `approved`, Feature status → `done` | must |
| AC-2.5.7 | `blueprint_reject_build({ build_cycle_id })` sets status to `rejected`, Feature returns to `building`, and all FUs with `critical` or `major` issues (including any FU marked `failed` during review) are reset to `pending` with `logStatusChange` audit entries. FUs without issues retain `passed` status | must |
| AC-2.5.8 | Rejection error response includes the list of failing gate conditions | should |

---

## WU-2.6: blueprint_get_context Tool

**`[SEQUENTIAL]` after WU-2.2d + WU-2.3**

### Description
Implement the full context retrieval tool that returns everything about a feature:
all cycles, all issues, full history. This is the read-heavy complement to `blueprint_resume`.

### File Ownership
```
src/tools/context.ts
src/db/queries/context.ts
```

### Acceptance Criteria

| ID | Description | Severity |
|----|-------------|----------|
| AC-2.6.1 | `blueprint_get_context({ feature_id? })` returns: feature, all FUs with ACs, all PlanCycles, all BuildCycles, all Issues, all WorkLocks, and status-audit history needed for full lifecycle context | must |
| AC-2.6.2 | If `feature_id` is omitted, returns context for the most recently active feature | must |
| AC-2.6.3 | Cycles include their full issue lists inline | must |
| AC-2.6.4 | BuildCycles include session logs and checkpoint data, and the response includes status-audit history for Feature, FunctionUnits, AcceptanceCriteria, and cycles | must |
| AC-2.6.5 | Response is a single structured JSON object (not multiple queries the client must assemble) | must |

---

## WU-2.7: Feature Lifecycle State Transitions

**`[SEQUENTIAL]` after WU-2.4 + WU-2.5**

### Description
Wire up the complete feature lifecycle: `draft → plan_review → building → build_review → done`.
Ensure transitions are enforced — no skipping states.

### File Ownership
```
src/entities/feature-lifecycle.ts   (state machine logic)
```

### Acceptance Criteria

| ID | Description | Severity |
|----|-------------|----------|
| AC-2.7.1 | Feature status can only transition through valid paths: `draft → plan_review → building → build_review → done` | must |
| AC-2.7.2 | `build_review` is entered when a BuildCycle moves to `reviewing` status | must |
| AC-2.7.3 | `done` is only reachable when at least one BuildCycle is `approved` AND no open `critical`/`major` issues exist | must |
| AC-2.7.4 | Rejected build cycles return feature to `building` (not `draft`) | must |
| AC-2.7.5 | Rejected plan cycles keep feature in `plan_review` (not `draft`) | must |
| AC-2.7.6 | Invalid state transitions return a descriptive error: `"Cannot transition from {current} to {target}"` | must |
