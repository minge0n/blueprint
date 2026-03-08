# Phase 3 — Parallel & Merge

> Dependency graph traversal, atomic work acquisition, heartbeat protocol,
> MergePoint detection. This phase makes Blueprint multi-agent safe.

## Phase Entry Criteria
- Phase 2 complete: all `must` ACs pass
- PlanCycle and BuildCycle state machines operational
- Issue tracking functional
- WorkLock table exists (from WU-1.7)

## Phase Exit Criteria
- `blueprint_get_available_work` atomically assigns FUs with no double-assignment
- Heartbeat + lock expiry cycle works end-to-end
- MergePoints activate when all trigger FUs pass
- `blueprint_get_parallel_status` returns accurate agent-to-FU mapping
- Integration issue categories are available

---

## WU-3.1: FU Dependency Graph Storage + Traversal

**`[PARALLEL-SAFE]` — Parallel with WU-3.6**

### Description
Build the dependency graph engine. Given a feature's FUs and their declared
dependencies, compute which FUs are unblocked (all hard dependencies satisfied),
detect cycles, and produce a topological ordering.

Also implements `blueprint_add_dependency` and `blueprint_get_dependency_graph`
tools — moved here from Phase 1 (WU-1.5) because the `fu_dependencies` table
is created in this work unit.

### File Ownership
```
src/db/migrations/007-fu-dependencies.ts
src/entities/fu-dependency.ts
src/graph/dependency.ts        (graph algorithms)
src/graph/types.ts
src/tools/dependency.ts        (add_dependency + get_dependency_graph tools)
src/db/queries/dependency.ts
```

### Acceptance Criteria

| ID | Description | Severity |
|----|-------------|----------|
| AC-3.1.1 | `fu_dependencies` table: `fu_id TEXT FK`, `depends_on_fu_id TEXT FK`, `type TEXT NOT NULL` (`hard` or `soft`), composite PK | must |
| AC-3.1.2 | `getUnblockedFUs(feature_id)` returns FUs where all `hard` dependencies have status `passed` | must |
| AC-3.1.3 | `getTopologicalOrder(feature_id)` returns FUs in valid execution order | must |
| AC-3.1.4 | Cycle detection: `addDependency` rejects if adding the edge creates a cycle in hard dependencies | must |
| AC-3.1.5 | Soft dependencies do not block execution — they only flag merge verification needed | must |
| AC-3.1.6 | Graph handles FUs with zero dependencies (they are always unblocked) | must |
| AC-3.1.7 | `blueprint_add_dependency({ fu_id, depends_on_fu_id, type })` creates a dependency link with `type` = `hard` or `soft` | must |
| AC-3.1.8 | `blueprint_get_dependency_graph({ feature_id })` returns all FUs with their dependency edges as an adjacency list | must |
| AC-3.1.9 | Adding a dependency where both FUs belong to different features returns an error | must |
| AC-3.1.10 | `getUnblockedFUs` accepts an optional `additionalBlockCheck(fu_id) → boolean` callback so that later work units (WU-3.4) can plug in MergePoint blocking without modifying this file | must |

---

## WU-3.2: blueprint_get_available_work (Atomic Lock Acquisition)

**`[SEQUENTIAL]` after WU-3.4 (needs dependency graph + MergePoint blocking) + WU-1.7 (needs WorkLock table)**

### Description
The core parallel dispatch tool. Atomically finds the highest-priority unblocked FU
that is not locked by another agent, acquires a WorkLock, and returns it.
Uses `BEGIN IMMEDIATE` to prevent race conditions.

### File Ownership
```
src/tools/available-work.ts
src/db/queries/available-work.ts
```

### Acceptance Criteria

| ID | Description | Severity |
|----|-------------|----------|
| AC-3.2.1 | `blueprint_get_available_work({ agent_id })` returns the highest-priority unblocked FU with a new active WorkLock, including `lock_id` and `build_cycle_id`, or `null` if none available | must |
| AC-3.2.2 | Lock acquisition uses `BEGIN IMMEDIATE` transaction — two concurrent calls never return the same FU | must |
| AC-3.2.3 | FUs with active WorkLocks held by other agents are excluded | must |
| AC-3.2.4 | FUs with status `passed` or `failed` are excluded | must |
| AC-3.2.5 | FUs whose hard dependencies are not all `passed` are excluded | must |
| AC-3.2.6 | The returned FU includes its full AC list and dependency info | must |
| AC-3.2.7 | FU status is set to `in_progress` upon lock acquisition | must |
| AC-3.2.8 | Priority ordering: FUs belonging to `p0` features first, then `p1`, then `p2`; within a feature, topological order | should |

---

## WU-3.3: blueprint_heartbeat + blueprint_release_lock

**`[PARALLEL-SAFE]` after WU-1.7 · Parallel with WU-3.2, WU-3.4**

### Description
Implement the heartbeat and lock release tools. Heartbeat updates `heartbeat_at`
to keep a lock alive. Release explicitly frees a lock.

### File Ownership
```
src/tools/lock.ts
src/db/queries/lock.ts
```

### Acceptance Criteria

| ID | Description | Severity |
|----|-------------|----------|
| AC-3.3.1 | `blueprint_heartbeat({ lock_id, agent_id })` updates `heartbeat_at` to current timestamp. `agent_id` is required to validate lock ownership | must |
| AC-3.3.2 | Heartbeat on an expired or released lock returns an error: `"Lock {lock_id} is no longer active"` | must |
| AC-3.3.3 | Heartbeat on a lock owned by a different `agent_id` returns an error: `"Lock {lock_id} is owned by {owner_agent_id}, not {caller_agent_id}"` | must |
| AC-3.3.4 | `blueprint_release_lock({ lock_id, agent_id, reason? })` sets lock status to `released`, records `released_at`, and only succeeds when the lock is owned by `agent_id`; otherwise it returns an ownership error | must |
| AC-3.3.5 | Releasing a lock does NOT change the FU status (FU may be `passed` or still `in_progress`) | must |
| AC-3.3.6 | Release stores `reason` in `work_locks.release_reason` if provided (for audit trail) | should |

---

## WU-3.4: MergePoint Entity + Tools

**`[SEQUENTIAL]` after WU-3.1**

### Description
Implement MergePoints — synchronization barriers where parallel FU streams
converge. A MergePoint activates when all its trigger FUs reach `passed`.
Wires into the dependency engine's `additionalBlockCheck` hook (AC-3.1.10)
to block `merged_fu` until its MergePoint is ready. Does NOT modify
`src/graph/dependency.ts` directly — uses the callback interface.

### File Ownership
```
src/db/migrations/008-merge-points.ts
src/entities/merge-point.ts
src/tools/merge-point.ts
src/db/queries/merge-point.ts
```

### Acceptance Criteria

| ID | Description | Severity |
|----|-------------|----------|
| AC-3.4.1 | `merge_points` table: `id TEXT PK`, `feature_id TEXT FK`, `trigger_fus TEXT NOT NULL` (JSON array of fu_ids), `merged_fu TEXT FK`, `status TEXT NOT NULL DEFAULT 'waiting'` | must |
| AC-3.4.2 | `blueprint_add_merge_point({ feature_id, trigger_fus, merged_fu })` creates a MergePoint | must |
| AC-3.4.3 | All `trigger_fus` must belong to the same feature — rejects otherwise | must |
| AC-3.4.4 | `merged_fu` must belong to the same feature — rejects otherwise | must |
| AC-3.4.5 | `blueprint_check_merge_ready({ merge_point_id })` returns `ready: true` when all trigger FUs have status `passed` | must |
| AC-3.4.6 | When a MergePoint becomes ready, its status transitions to `ready`. Registers a block check via the dependency engine's `additionalBlockCheck` hook that returns `true` (blocked) for any `merged_fu` whose MergePoint status ≠ `ready` | must |
| AC-3.4.7 | MergePoint status transitions: `waiting → ready → passed | failed` (based on merged_fu outcome) | must |

---

## WU-3.5: blueprint_get_parallel_status

**`[SEQUENTIAL]` after WU-3.2 + WU-3.4**

### Description
Implement the parallel status dashboard tool. Returns a complete picture of
what every agent is doing, which FUs are blocked, and which MergePoints are pending.

### File Ownership
```
src/tools/parallel-status.ts
src/db/queries/parallel-status.ts
```

### Acceptance Criteria

| ID | Description | Severity |
|----|-------------|----------|
| AC-3.5.1 | `blueprint_get_parallel_status({ feature_id })` returns: `agents` (agent_id → locked FU mapping including `lock_id`), `merge_points` (with readiness status), `blocked_fus` (FUs waiting on dependencies), `available_fus` (unblocked and unlocked) | must |
| AC-3.5.2 | Expired locks are not shown as active agent assignments | must |
| AC-3.5.3 | Each agent entry includes: `agent_id`, `fu_id`, `lock_id`, `lock_acquired_at`, `last_heartbeat` | must |
| AC-3.5.4 | Blocked FUs include the reason: which dependency is not yet `passed` | should |
| AC-3.5.5 | Response is a single structured JSON object | must |

---

## WU-3.6: Integration Issue Categories

**`[PARALLEL-SAFE]` — Parallel with WU-3.1**

### Description
Extend the Issue entity to fully support the three integration-specific categories:
`integration_conflict`, `race_condition`, `interface_mismatch`. These categories
were defined in Phase 2's schema, including `related_fu_id`, but need specific
validation and query support for parallel execution scenarios.

### File Ownership
```
src/tools/issue-integration.ts     (integration-specific issue helpers)
src/db/queries/issue-integration.ts
```

### Acceptance Criteria

| ID | Description | Severity |
|----|-------------|----------|
| AC-3.6.1 | `blueprint_add_issue` with `category: 'integration_conflict'` requires both `fu_id` (primary) and `related_fu_id` (the conflicting FU) — rejects if `related_fu_id` is null for this category | must |
| AC-3.6.2 | `blueprint_add_issue` with `category: 'race_condition'` requires description of the shared state being contested | must |
| AC-3.6.3 | `blueprint_add_issue` with `category: 'interface_mismatch'` requires description of expected vs. actual interface | must |
| AC-3.6.4 | `blueprint_list_issues` can filter by integration categories specifically: `{ category: ['integration_conflict', 'race_condition', 'interface_mismatch'] }` (built on the base category filter introduced in Phase 2) | must |
| AC-3.6.5 | Integration issues are always `severity: 'critical'` by default (can be overridden) | should |
