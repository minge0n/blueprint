import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import {
  addAcceptanceCriteria,
  updateAcceptanceCriteria,
} from '../db/queries/acceptance-criteria.js';
import {
  ACCEPTANCE_CRITERIA_SEVERITIES,
  ACCEPTANCE_CRITERIA_STATUSES,
  ACCEPTANCE_CRITERIA_TYPES,
  type AcceptanceCriteriaSeverity,
  type AcceptanceCriteriaStatus,
  type AcceptanceCriteriaType,
} from '../entities/types.js';
import {
  createTextToolResult,
  createToolErrorResult,
  defineTool,
  type BlueprintToolDefinition,
} from './types.js';

function isAcceptanceCriteriaType(value: string): value is AcceptanceCriteriaType {
  switch (value) {
    case ACCEPTANCE_CRITERIA_TYPES.FUNCTIONAL:
    case ACCEPTANCE_CRITERIA_TYPES.PERFORMANCE:
    case ACCEPTANCE_CRITERIA_TYPES.SECURITY:
    case ACCEPTANCE_CRITERIA_TYPES.EDGE_CASE:
      return true;
    default:
      return false;
  }
}

function isAcceptanceCriteriaSeverity(value: string): value is AcceptanceCriteriaSeverity {
  switch (value) {
    case ACCEPTANCE_CRITERIA_SEVERITIES.MUST:
    case ACCEPTANCE_CRITERIA_SEVERITIES.SHOULD:
    case ACCEPTANCE_CRITERIA_SEVERITIES.NICE_TO_HAVE:
      return true;
    default:
      return false;
  }
}

function isAcceptanceCriteriaStatus(value: string): value is AcceptanceCriteriaStatus {
  switch (value) {
    case ACCEPTANCE_CRITERIA_STATUSES.NOT_TESTED:
    case ACCEPTANCE_CRITERIA_STATUSES.PASSED:
    case ACCEPTANCE_CRITERIA_STATUSES.FAILED:
    case ACCEPTANCE_CRITERIA_STATUSES.BLOCKED:
      return true;
    default:
      return false;
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
}

export const acceptanceCriteriaToolDefinitions: Array<BlueprintToolDefinition> = [
  defineTool({
    name: 'blueprint_add_ac',
    description: 'Add acceptance criteria to a function unit.',
    inputSchema: {
      fu_id: z.string().min(1),
      description: z.string().min(1),
      type: z.string().min(1),
      severity: z.string().min(1),
    },
    handler: (
      { fu_id, description, type, severity },
      _extra
    ): CallToolResult => {
      if (!isAcceptanceCriteriaType(type)) {
        return createToolErrorResult(`Invalid acceptance criteria type: ${type}`);
      }

      if (!isAcceptanceCriteriaSeverity(severity)) {
        return createToolErrorResult(`Invalid acceptance criteria severity: ${severity}`);
      }

      try {
        const acceptanceCriteria = addAcceptanceCriteria({
          fu_id,
          description,
          type,
          severity,
        });

        return createTextToolResult(JSON.stringify(acceptanceCriteria, null, 2));
      } catch (error: unknown) {
        return createToolErrorResult(getErrorMessage(error));
      }
    },
  }),
  defineTool({
    name: 'blueprint_update_ac',
    description: 'Update acceptance criteria verification state.',
    inputSchema: {
      ac_id: z.string().min(1),
      status: z.string().min(1),
      verified_in: z.string().min(1).optional(),
      evidence: z.string().min(1).optional(),
    },
    handler: (
      { ac_id, status, verified_in, evidence },
      _extra
    ): CallToolResult => {
      if (!isAcceptanceCriteriaStatus(status)) {
        return createToolErrorResult(`Invalid acceptance criteria status: ${status}`);
      }

      try {
        const acceptanceCriteria = updateAcceptanceCriteria({
          ac_id,
          status,
          verified_in,
          evidence,
        });

        return createTextToolResult(JSON.stringify(acceptanceCriteria, null, 2));
      } catch (error: unknown) {
        return createToolErrorResult(getErrorMessage(error));
      }
    },
  }),
];
