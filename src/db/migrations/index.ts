import coreEntitiesMigration from './001-core-entities.js';
import statusAuditLogMigration from './002-status-audit-log.js';
import workLocksMigration from './003-work-locks.js';
import planCyclesMigration from './004-plan-cycles.js';
import buildCyclesMigration from './005-build-cycles.js';
import issuesMigration from './006-issues.js';
import functionUnitDependenciesMigration from './007-fu-dependencies.js';
import mergePointsMigration from './008-merge-points.js';
import type { Migration } from './types.js';

export function getMigrations(): Array<Migration> {
  return [
    coreEntitiesMigration,
    statusAuditLogMigration,
    workLocksMigration,
    planCyclesMigration,
    buildCyclesMigration,
    issuesMigration,
    functionUnitDependenciesMigration,
    mergePointsMigration,
  ];
}
