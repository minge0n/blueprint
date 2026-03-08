import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getDb, resetDbForTests } from '../src/db/index.js';
import { addAcceptanceCriteria } from '../src/db/queries/acceptance-criteria.js';
import { blueprintGetAvailableWork } from '../src/db/queries/available-work.js';
import { blueprintCompleteFu } from '../src/db/queries/checkpoint.js';
import { addMergePoint, checkMergeReady } from '../src/db/queries/merge-point.js';
import { startBuild } from '../src/db/queries/build-cycle.js';
import { blueprintGetContext } from '../src/db/queries/context.js';
import { createFeature } from '../src/db/queries/feature.js';
import { addFunctionUnit } from '../src/db/queries/function-unit.js';
import { analyzeBlueprintHistory } from '../src/analysis/recurrence.js';
import { createBlueprintExport } from '../src/export/markdown.js';
import { createBlueprintServer } from '../src/server.js';
import { registerTools } from '../src/tools/index.js';
import { rejectBuild } from '../src/tools/build-gate.js';
import {
  createTextToolResult,
  type BlueprintToolDefinition,
} from '../src/tools/types.js';
import {
  ACCEPTANCE_CRITERIA_SEVERITIES,
  ACCEPTANCE_CRITERIA_TYPES,
  FEATURE_STATUSES,
  FEATURE_PRIORITIES,
} from '../src/entities/types.js';
import { addIssue } from '../src/db/queries/issue.js';
import { ISSUE_CATEGORIES, ISSUE_PARENT_TYPES, ISSUE_SEVERITIES } from '../src/entities/issue.js';

const BLUEPRINT_HOME_ENV_KEY = 'BLUEPRINT_HOME';
const DB_FILENAME = 'db.sqlite';

interface SqliteMasterTableRow {
  readonly name: string;
}

const tempDirectories: Array<string> = [];
const originalBlueprintHome = process.env[BLUEPRINT_HOME_ENV_KEY];

function createTempBlueprintHome(): string {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'blueprint-test-'));
  tempDirectories.push(tempDirectory);
  process.env[BLUEPRINT_HOME_ENV_KEY] = tempDirectory;
  resetDbForTests();

  return tempDirectory;
}

function listTableNames(): Array<string> {
  const db = getDb();
  const statement = db.prepare<[], SqliteMasterTableRow>(
    `SELECT name
     FROM sqlite_master
     WHERE type = 'table'
     ORDER BY name ASC`
  );

  return statement.all().map((row: SqliteMasterTableRow): string => row.name);
}

afterEach((): void => {
  resetDbForTests();

  if (originalBlueprintHome === undefined) {
    delete process.env[BLUEPRINT_HOME_ENV_KEY];
  } else {
    process.env[BLUEPRINT_HOME_ENV_KEY] = originalBlueprintHome;
  }

  for (const tempDirectory of tempDirectories.splice(0)) {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('getDb initializes sqlite under temp BLUEPRINT_HOME with required pragmas', (): void => {
  const blueprintHome = createTempBlueprintHome();
  const expectedDatabasePath = path.join(blueprintHome, DB_FILENAME);

  const db = getDb();

  assert.strictEqual(db.name, expectedDatabasePath);
  assert.ok(fs.existsSync(expectedDatabasePath));
  assert.strictEqual(db.pragma('journal_mode', { simple: true }), 'wal');
  assert.strictEqual(db.pragma('foreign_keys', { simple: true }), 1);
});

test('getDb creates schema_migrations and core entity tables', (): void => {
  createTempBlueprintHome();

  const tableNames = listTableNames();
  const expectedTableNames: Array<string> = [
    'acceptance_criteria',
    'build_cycles',
    'checkpoints',
    'feature_dependencies',
    'features',
    'fu_dependencies',
    'function_units',
    'issues',
    'merge_points',
    'plan_cycles',
    'schema_migrations',
    'session_logs',
    'sqlite_sequence',
    'status_audit_log',
    'work_locks',
  ];

  for (const tableName of expectedTableNames) {
    assert.ok(tableNames.includes(tableName), `Expected table ${tableName} to exist`);
  }
});

test('createBlueprintServer returns a server and tool registration works', (): void => {
  const server = createBlueprintServer();
  const tools: Array<BlueprintToolDefinition> = [
    {
      name: 'phase1-healthcheck',
      description: 'Test tool without input',
      handler: () => createTextToolResult('ok'),
    },
    {
      name: 'phase1-echo',
      description: 'Test tool with input',
      inputSchema: {
        message: z.string(),
      },
      handler: ({ message }) => createTextToolResult(message),
    },
  ];

  const registeredToolNames = registerTools(server, tools);

  assert.ok(server instanceof McpServer);
  assert.deepStrictEqual(registeredToolNames, ['phase1-healthcheck', 'phase1-echo']);
});

test('available work respects merge points and integration issues default to critical severity', (): void => {
  createTempBlueprintHome();

  const feature = createFeature({
    title: 'Parallel Merge Feature',
    scope: 'Validate phase 3 orchestration.',
    out_of_scope: 'Production implementation details.',
    priority: FEATURE_PRIORITIES.P0,
  });
  const db = getDb();
  db.prepare('UPDATE features SET status = ? WHERE id = ?').run(FEATURE_STATUSES.BUILDING, feature.id);

  const fuA = addFunctionUnit({
    feature_id: feature.id,
    title: 'Prepare left branch',
    description: 'First trigger unit.',
  });
  const fuB = addFunctionUnit({
    feature_id: feature.id,
    title: 'Prepare right branch',
    description: 'Second trigger unit.',
  });
  const fuC = addFunctionUnit({
    feature_id: feature.id,
    title: 'Merge branches',
    description: 'Merged unit that must wait for both triggers.',
  });

  addAcceptanceCriteria({
    fu_id: fuA.id,
    description: 'Left branch completes.',
    type: ACCEPTANCE_CRITERIA_TYPES.FUNCTIONAL,
    severity: ACCEPTANCE_CRITERIA_SEVERITIES.MUST,
  });
  addAcceptanceCriteria({
    fu_id: fuB.id,
    description: 'Right branch completes.',
    type: ACCEPTANCE_CRITERIA_TYPES.FUNCTIONAL,
    severity: ACCEPTANCE_CRITERIA_SEVERITIES.MUST,
  });
  addAcceptanceCriteria({
    fu_id: fuC.id,
    description: 'Merged output completes.',
    type: ACCEPTANCE_CRITERIA_TYPES.FUNCTIONAL,
    severity: ACCEPTANCE_CRITERIA_SEVERITIES.MUST,
  });

  const buildStart = startBuild({
    feature_id: feature.id,
    agent_id: 'coordinator',
  });
  const mergePoint = addMergePoint({
    feature_id: feature.id,
    trigger_fus: [fuA.id, fuB.id],
    merged_fu: fuC.id,
  });

  const firstAssignment = blueprintGetAvailableWork({ agent_id: 'worker-a' });

  assert.notStrictEqual(firstAssignment, null);

  if (firstAssignment === null) {
    throw new Error('Expected first assignment to exist');
  }

  assert.strictEqual(firstAssignment.fu.id, fuA.id);

  const repeatedAssignment = blueprintGetAvailableWork({ agent_id: 'worker-a' });

  if (repeatedAssignment === null) {
    throw new Error('Expected repeated assignment to exist');
  }

  assert.strictEqual(repeatedAssignment.lock_id, firstAssignment.lock_id);
  assert.strictEqual(repeatedAssignment.fu.id, fuA.id);

  blueprintCompleteFu({
    build_cycle_id: buildStart.build_cycle.id,
    fu_id: fuA.id,
    agent_id: 'worker-a',
    evidence: 'completed left branch',
  });

  const secondAssignment = blueprintGetAvailableWork({ agent_id: 'worker-b' });

  assert.notStrictEqual(secondAssignment, null);

  if (secondAssignment === null) {
    throw new Error('Expected second assignment to exist');
  }

  assert.strictEqual(secondAssignment.fu.id, fuB.id);

  blueprintCompleteFu({
    build_cycle_id: buildStart.build_cycle.id,
    fu_id: fuB.id,
    agent_id: 'worker-b',
    evidence: 'completed right branch',
  });

  const mergeReady = checkMergeReady(mergePoint.id);

  assert.strictEqual(mergeReady.ready, true);

  const thirdAssignment = blueprintGetAvailableWork({ agent_id: 'worker-c' });

  assert.notStrictEqual(thirdAssignment, null);

  if (thirdAssignment === null) {
    throw new Error('Expected third assignment to exist');
  }

  assert.strictEqual(thirdAssignment.fu.id, fuC.id);

  const integrationIssue = addIssue({
    parent_type: ISSUE_PARENT_TYPES.BUILD,
    parent_id: buildStart.build_cycle.id,
    fu_id: fuC.id,
    related_fu_id: fuA.id,
    category: ISSUE_CATEGORIES.INTEGRATION_CONFLICT,
    title: 'Merge conflict risk',
    description: 'Potential integration conflict between merged output and trigger.',
  });

  assert.strictEqual(integrationIssue.severity, ISSUE_SEVERITIES.CRITICAL);
});

test('export and history analysis produce feature artifacts', (): void => {
  const blueprintHome = createTempBlueprintHome();
  const feature = createFeature({
    title: 'Exportable Feature',
    scope: 'Exercise export and history tooling.',
    out_of_scope: 'Coordinator integration.',
    priority: FEATURE_PRIORITIES.P1,
  });
  const db = getDb();
  db.prepare('UPDATE features SET status = ? WHERE id = ?').run(FEATURE_STATUSES.BUILDING, feature.id);

  const fu = addFunctionUnit({
    feature_id: feature.id,
    title: 'Implement export surface',
    description: 'Single FU for export smoke test.',
  });

  addAcceptanceCriteria({
    fu_id: fu.id,
    description: 'Export returns markdown.',
    type: ACCEPTANCE_CRITERIA_TYPES.FUNCTIONAL,
    severity: ACCEPTANCE_CRITERIA_SEVERITIES.MUST,
  });
  addAcceptanceCriteria({
    fu_id: fu.id,
    description: 'Export handles empty issue list.',
    type: ACCEPTANCE_CRITERIA_TYPES.EDGE_CASE,
    severity: ACCEPTANCE_CRITERIA_SEVERITIES.SHOULD,
  });

  const buildStart = startBuild({
    feature_id: feature.id,
    agent_id: 'history-agent',
  });
  const assignment = blueprintGetAvailableWork({ agent_id: 'history-worker' });

  if (assignment === null) {
    throw new Error('Expected available work assignment for export test');
  }

  blueprintCompleteFu({
    build_cycle_id: buildStart.build_cycle.id,
    fu_id: fu.id,
    agent_id: 'history-worker',
    evidence: 'export smoke evidence',
  });

  const context = blueprintGetContext({ feature_id: feature.id });
  const exportResult = createBlueprintExport(context);
  const history = analyzeBlueprintHistory(context);

  assert.ok(exportResult.markdown.includes(feature.title));
  assert.ok(exportResult.output_path.includes(path.join(blueprintHome, 'exports')));
  assert.strictEqual(history.feature_id, feature.id);
  assert.strictEqual(history.build_cycle_count, 1);
  assert.strictEqual(history.ac_failure_rates.find((entry) => entry.type === ACCEPTANCE_CRITERIA_TYPES.EDGE_CASE)?.total, 1);
});

test('reject build resets merge point so merged work can be reassigned', (): void => {
  createTempBlueprintHome();

  const feature = createFeature({
    title: 'Merge Reset Feature',
    scope: 'Validate merge-point reset on build rejection.',
    out_of_scope: 'Coordinator behavior.',
    priority: FEATURE_PRIORITIES.P0,
  });
  const db = getDb();
  db.prepare('UPDATE features SET status = ? WHERE id = ?').run(FEATURE_STATUSES.BUILDING, feature.id);

  const leftFu = addFunctionUnit({
    feature_id: feature.id,
    title: 'Left branch',
    description: 'Trigger branch one.',
  });
  const rightFu = addFunctionUnit({
    feature_id: feature.id,
    title: 'Right branch',
    description: 'Trigger branch two.',
  });
  const mergedFu = addFunctionUnit({
    feature_id: feature.id,
    title: 'Merged branch',
    description: 'Merged output.',
  });

  addAcceptanceCriteria({
    fu_id: leftFu.id,
    description: 'Left passes.',
    type: ACCEPTANCE_CRITERIA_TYPES.FUNCTIONAL,
    severity: ACCEPTANCE_CRITERIA_SEVERITIES.MUST,
  });
  addAcceptanceCriteria({
    fu_id: rightFu.id,
    description: 'Right passes.',
    type: ACCEPTANCE_CRITERIA_TYPES.FUNCTIONAL,
    severity: ACCEPTANCE_CRITERIA_SEVERITIES.MUST,
  });
  addAcceptanceCriteria({
    fu_id: mergedFu.id,
    description: 'Merged passes.',
    type: ACCEPTANCE_CRITERIA_TYPES.FUNCTIONAL,
    severity: ACCEPTANCE_CRITERIA_SEVERITIES.MUST,
  });

  const buildStart = startBuild({
    feature_id: feature.id,
    agent_id: 'reset-coordinator',
  });

  addMergePoint({
    feature_id: feature.id,
    trigger_fus: [leftFu.id, rightFu.id],
    merged_fu: mergedFu.id,
  });

  const leftAssignment = blueprintGetAvailableWork({ agent_id: 'reset-left' });
  const rightAssignment = blueprintGetAvailableWork({ agent_id: 'reset-right' });

  if (leftAssignment === null || rightAssignment === null) {
    throw new Error('Expected trigger assignments to exist');
  }

  blueprintCompleteFu({
    build_cycle_id: buildStart.build_cycle.id,
    fu_id: leftAssignment.fu.id,
    agent_id: leftAssignment.work_lock.agent_id,
    evidence: 'left evidence',
  });
  blueprintCompleteFu({
    build_cycle_id: buildStart.build_cycle.id,
    fu_id: rightAssignment.fu.id,
    agent_id: rightAssignment.work_lock.agent_id,
    evidence: 'right evidence',
  });

  const mergePointReadyCheck = checkMergeReady(`merge_point_${feature.id}_1`);

  assert.strictEqual(mergePointReadyCheck.ready, true);

  const mergedAssignment = blueprintGetAvailableWork({ agent_id: 'reset-merged' });

  if (mergedAssignment === null) {
    throw new Error('Expected merged assignment to exist');
  }

  blueprintCompleteFu({
    build_cycle_id: buildStart.build_cycle.id,
    fu_id: mergedFu.id,
    agent_id: 'reset-merged',
    evidence: 'merged evidence',
  });

  addIssue({
    parent_type: ISSUE_PARENT_TYPES.BUILD,
    parent_id: buildStart.build_cycle.id,
    fu_id: mergedFu.id,
    category: ISSUE_CATEGORIES.IMPLEMENTATION,
    severity: ISSUE_SEVERITIES.CRITICAL,
    title: 'Merged output failed review',
    description: 'Critical flaw found in merged output.',
  });

  db.prepare('UPDATE build_cycles SET status = ? WHERE id = ?').run('reviewing', buildStart.build_cycle.id);
  db.prepare('UPDATE features SET status = ? WHERE id = ?').run('build_review', feature.id);

  rejectBuild({ build_cycle_id: buildStart.build_cycle.id });

  const secondBuild = startBuild({
    feature_id: feature.id,
    agent_id: 'reset-coordinator',
  });
  const reassignment = blueprintGetAvailableWork({ agent_id: 'reset-merged' });

  assert.ok(secondBuild.build_cycle.id.length > 0);
  assert.notStrictEqual(reassignment, null);
});
