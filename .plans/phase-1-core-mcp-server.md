# Phase 1 — Core MCP Server

> Foundation: project scaffold, SQLite persistence, base entities, essential tools.
> No cycles, no issues, no parallel execution yet. Just the skeleton that everything else builds on.

## Phase Entry Criteria
- None. This is the first phase.

## Phase Exit Criteria
- All `must` acceptance criteria across all work units pass
- MCP server starts, connects to a client, and responds to tool calls
- SQLite database creates all tables on first run (core entities + work_locks + status_audit_log)
- Watchdog reaper runs on a 30-second interval

---

## WU-1.1: Project Scaffold + SQLite Setup

**`[SEQUENTIAL]` — must complete before all other WUs in this phase**

### Description
Initialize the Node.js + TypeScript project. Configure `better-sqlite3` with
WAL mode. Create the database initialization module that ensures tables exist
on startup.

### File Ownership
```
package.json
tsconfig.json
src/index.ts              (entrypoint stub)
src/db/index.ts           (connection + WAL pragma + init)
src/db/migrations/        (schema creation)
```

### Acceptance Criteria

| ID | Description | Severity |
|----|-------------|----------|
| AC-1.1.1 | `npm install` succeeds with `@modelcontextprotocol/sdk`, `better-sqlite3`, `typescript` as dependencies | must |
| AC-1.1.2 | `tsconfig.json` targets ES2022, strict mode enabled | must |
| AC-1.1.3 | `src/db/index.ts` exports a `getDb()` function that returns a `better-sqlite3` Database instance | must |
| AC-1.1.4 | Database opens with `PRAGMA journal_mode=WAL` and `PRAGMA foreign_keys=ON` | must |
| AC-1.1.5 | `npm run build` produces valid JS output in `dist/` | must |
| AC-1.1.6 | `npm run dev` script exists for development | should |

---

## WU-1.2: Entity Schemas — Feature, FunctionUnit, AcceptanceCriteria

**`[PARALLEL-SAFE]` after WU-1.1 · Parallel with WU-1.3**

### Description
Define SQLite table schemas and TypeScript types for the three core entities.
Write the migration that creates these tables. Include foreign key relationships.

### File Ownership
```
src/db/migrations/001-core-entities.ts
src/entities/feature.ts
src/entities/function-unit.ts
src/entities/acceptance-criteria.ts
src/entities/types.ts          (shared enums/types)
```

### Acceptance Criteria

| ID | Description | Severity |
|----|-------------|----------|
| AC-1.2.1 | `features` table has columns: `id TEXT PK`, `title TEXT NOT NULL`, `scope TEXT NOT NULL`, `out_of_scope TEXT NOT NULL DEFAULT ''`, `status TEXT NOT NULL DEFAULT 'draft'`, `priority TEXT NOT NULL DEFAULT 'p1'` | must |
| AC-1.2.2 | `function_units` table has columns: `id TEXT PK`, `feature_id TEXT FK→features`, `title TEXT NOT NULL`, `description TEXT NOT NULL`, `status TEXT NOT NULL DEFAULT 'pending'`, `assigned_agent TEXT`, `test_evidence TEXT`, `failure_reason TEXT` | must |
| AC-1.2.3 | `acceptance_criteria` table has columns: `id TEXT PK`, `fu_id TEXT FK→function_units`, `description TEXT NOT NULL`, `type TEXT NOT NULL`, `severity TEXT NOT NULL`, `status TEXT NOT NULL DEFAULT 'not_tested'`, `verified_in TEXT`, `evidence TEXT` | must |
| AC-1.2.4 | `feature_dependencies` table: `feature_id TEXT FK`, `depends_on TEXT FK`, composite PK | must |
| AC-1.2.5 | TypeScript types match the spec's data model exactly, including `FunctionUnit.failure_reason` and `AcceptanceCriteria.evidence`; `FunctionUnit.depends_on` exists in the type and is returned as an empty array until Phase 3 persists FU dependencies | must |
| AC-1.2.6 | Foreign key constraints enforced — inserting a FU with a nonexistent `feature_id` throws | must |
| AC-1.2.7 | Status columns use CHECK constraints matching the spec's enum values | should |

---

## WU-1.3: MCP Server Bootstrap

**`[PARALLEL-SAFE]` after WU-1.1 · Parallel with WU-1.2**

### Description
Set up the MCP server using `@modelcontextprotocol/sdk`. Register the server
with stdio transport. Create the tool registration framework so subsequent WUs
can add tools by exporting a standard interface.

### File Ownership
```
src/server.ts              (MCP server init + tool registry)
src/tools/index.ts         (tool registration framework)
src/tools/types.ts         (shared tool input/output types)
```

### Acceptance Criteria

| ID | Description | Severity |
|----|-------------|----------|
| AC-1.3.1 | MCP server starts and accepts connections via stdio transport | must |
| AC-1.3.2 | Tool registration framework: a tool is defined as `{ name, description, inputSchema, handler }` and auto-registered | must |
| AC-1.3.3 | Server responds to `tools/list` with all registered tools | must |
| AC-1.3.4 | Server responds to `tools/call` and routes to the correct handler | must |
| AC-1.3.5 | Invalid tool name returns a structured error, not a crash | must |
| AC-1.3.6 | Server logs startup and connection events to stderr | should |

---

## WU-1.4: Feature Management Tools

**`[PARALLEL-SAFE]` after WU-1.2 + WU-1.3 + WU-1.6 · Parallel with WU-1.5, WU-1.7**

### Description
Implement `blueprint_create_feature`, `blueprint_list_features`, `blueprint_get_feature`.
These are CRUD tools for the Feature entity.

### File Ownership
```
src/tools/feature.ts
src/db/queries/feature.ts
```

### Acceptance Criteria

| ID | Description | Severity |
|----|-------------|----------|
| AC-1.4.1 | `blueprint_create_feature({ title, scope, out_of_scope, priority, depends_on? })` inserts a row and returns the full Feature object with generated `id` | must |
| AC-1.4.2 | `id` is generated as `feat_{slug}_{3-digit-counter}` where slug is derived from title | must |
| AC-1.4.3 | `blueprint_list_features({ status? })` returns all features, optionally filtered by status | must |
| AC-1.4.4 | `blueprint_get_feature({ feature_id })` returns the full Feature including its FUs and ACs | must |
| AC-1.4.5 | Creating a feature with `depends_on` referencing a nonexistent feature returns an error | must |
| AC-1.4.6 | `priority` validates against `p0`, `p1`, `p2` — rejects other values | must |

---

## WU-1.5: FunctionUnit + AcceptanceCriteria Tools

**`[PARALLEL-SAFE]` after WU-1.2 + WU-1.3 + WU-1.6 · Parallel with WU-1.4, WU-1.7**

### Description
Implement `blueprint_add_function_unit`, `blueprint_add_ac`, `blueprint_update_ac`.
FU dependency tools (`blueprint_add_dependency`, `blueprint_get_dependency_graph`)
are deferred to Phase 3 (WU-3.1) where the `fu_dependencies` table is created.

### File Ownership
```
src/tools/function-unit.ts
src/tools/acceptance-criteria.ts
src/db/queries/function-unit.ts
src/db/queries/acceptance-criteria.ts
```

### Acceptance Criteria

| ID | Description | Severity |
|----|-------------|----------|
| AC-1.5.1 | `blueprint_add_function_unit({ feature_id, title, description })` inserts and returns the FU with generated `id` as `fu_{counter}_{slug}` | must |
| AC-1.5.2 | `blueprint_add_ac({ fu_id, description, type, severity })` inserts and returns the AC | must |
| AC-1.5.3 | `type` validates against `functional`, `performance`, `security`, `edge_case` | must |
| AC-1.5.4 | `severity` validates against `must`, `should`, `nice_to_have` | must |
| AC-1.5.5 | `blueprint_update_ac({ ac_id, status, verified_in?, evidence? })` updates AC status. `verified_in` is a build_cycle_id (optional). `evidence` is descriptive text (optional). These are distinct fields — not conflated | must |

---

## WU-1.6: Status Audit Log Table

**`[PARALLEL-SAFE]` after WU-1.2 · Parallel with WU-1.3**

### Description
Create the `status_audit_log` table that records every status change for Features,
FunctionUnits, AcceptanceCriteria, and (from Phase 2 onward) PlanCycles and BuildCycles.
This is the foundation for `blueprint_get_history`
(Phase 4) which needs rework counts and failure-before-pass rates — data that cannot
be derived from current-status-only columns. The logging helper defined here must
exist before Phase 1 status-mutating tools wire it in.

### File Ownership
```
src/db/migrations/002-status-audit-log.ts
src/entities/status-audit-log.ts
src/db/queries/status-audit-log.ts
```

### Acceptance Criteria

| ID | Description | Severity |
|----|-------------|----------|
| AC-1.6.1 | `status_audit_log` table: `id INTEGER PK AUTOINCREMENT`, `entity_type TEXT NOT NULL` (`feature`, `function_unit`, `acceptance_criteria`, `plan_cycle`, `build_cycle`), `entity_id TEXT NOT NULL`, `old_status TEXT`, `new_status TEXT NOT NULL`, `changed_at TEXT NOT NULL`, `changed_by TEXT` (agent_id or null), `context TEXT` (cycle_id or other reference) | must |
| AC-1.6.2 | A helper function `logStatusChange(entity_type, entity_id, old_status, new_status, changed_by?, context?)` inserts a row | must |
| AC-1.6.3 | All existing status-mutating operations in Phase 1 (Feature creation, FU creation, AC updates) call `logStatusChange` | must |
| AC-1.6.4 | `getStatusHistory(entity_type, entity_id)` returns all audit rows for a given entity, ordered by `changed_at` ascending | must |
| AC-1.6.5 | Audit log is append-only — no UPDATE or DELETE operations exposed | must |

---

## WU-1.7: WorkLock Table + Watchdog Reaper

**`[PARALLEL-SAFE]` after WU-1.2 + WU-1.6 · Parallel with WU-1.4, WU-1.5**

### Description
Create the `work_locks` table and the watchdog process that expires stale locks.
This is the foundation for parallel execution in Phase 3, but the table and
reaper must exist from Phase 1. In Phase 1 the watchdog only expires locks,
resets FUs, writes audit entries, and logs to stderr. Session-log integration is
added in Phase 2 once `build_cycles` and `session_logs` exist.

### File Ownership
```
src/db/migrations/003-work-locks.ts
src/entities/work-lock.ts
src/watchdog.ts
```

### Acceptance Criteria

| ID | Description | Severity |
|----|-------------|----------|
| AC-1.7.1 | `work_locks` table has columns: `id TEXT PK`, `fu_id TEXT FK→function_units`, `agent_id TEXT NOT NULL`, `acquired_at TEXT NOT NULL`, `heartbeat_at TEXT NOT NULL`, `released_at TEXT`, `release_reason TEXT`, `ttl_seconds INTEGER NOT NULL DEFAULT 300`, `status TEXT NOT NULL DEFAULT 'active'` | must |
| AC-1.7.2 | Watchdog runs on a 30-second `setInterval` | must |
| AC-1.7.3 | Watchdog finds all locks where `heartbeat_at < now - ttl_seconds` and sets `status → 'expired'` | must |
| AC-1.7.4 | When a lock expires, the associated FU's `status` is reset to `pending` and a `logStatusChange` audit entry is written | must |
| AC-1.7.5 | Watchdog logs each expiration event to stderr with lock_id, fu_id, agent_id | must |
| AC-1.7.6 | Unique constraint: only one `active` lock per `fu_id` at a time | must |
