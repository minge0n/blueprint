import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { addIssue, listIssues, resolveIssue } from '../db/queries/issue.js';
import {
  ISSUE_CATEGORIES,
  ISSUE_PARENT_TYPES,
  ISSUE_SEVERITIES,
  ISSUE_STATUSES,
} from '../entities/issue.js';
import {
  createTextToolResult,
  createToolErrorResult,
  defineTool,
  type BlueprintToolDefinition,
} from './types.js';

const addIssueInputSchema = {
  parent_type: z.enum([ISSUE_PARENT_TYPES.PLAN, ISSUE_PARENT_TYPES.BUILD]),
  parent_id: z.string().min(1),
  fu_id: z.string().min(1),
  ac_id: z.string().min(1).optional(),
  related_fu_id: z.string().min(1).optional(),
  category: z.enum([
    ISSUE_CATEGORIES.MISSING_CASE,
    ISSUE_CATEGORIES.WRONG_ASSUMPTION,
    ISSUE_CATEGORIES.SCOPE_CREEP,
    ISSUE_CATEGORIES.AMBIGUITY,
    ISSUE_CATEGORIES.DEPENDENCY_GAP,
    ISSUE_CATEGORIES.SECURITY_GAP,
    ISSUE_CATEGORIES.PERFORMANCE_GAP,
    ISSUE_CATEGORIES.IMPLEMENTATION,
    ISSUE_CATEGORIES.INTEGRATION_CONFLICT,
    ISSUE_CATEGORIES.RACE_CONDITION,
    ISSUE_CATEGORIES.INTERFACE_MISMATCH,
  ]),
  severity: z.enum([
    ISSUE_SEVERITIES.CRITICAL,
    ISSUE_SEVERITIES.MAJOR,
    ISSUE_SEVERITIES.MINOR,
    ISSUE_SEVERITIES.NITPICK,
  ]).optional(),
  title: z.string().min(1),
  description: z.string().min(1),
  suggested_fix: z.string().min(1).optional(),
};

const resolveIssueInputSchema = {
  issue_id: z.string().min(1),
  status: z.enum([ISSUE_STATUSES.RESOLVED, ISSUE_STATUSES.WONT_FIX]),
  resolved_in: z.string().min(1),
  resolution_note: z.string().min(1).optional(),
};

const listIssuesInputSchema = {
  feature_id: z.string().min(1).optional(),
  status: z
    .enum([
      ISSUE_STATUSES.OPEN,
      ISSUE_STATUSES.IN_PROGRESS,
      ISSUE_STATUSES.RESOLVED,
      ISSUE_STATUSES.WONT_FIX,
    ])
    .optional(),
  severity: z
    .enum([
      ISSUE_SEVERITIES.CRITICAL,
      ISSUE_SEVERITIES.MAJOR,
      ISSUE_SEVERITIES.MINOR,
      ISSUE_SEVERITIES.NITPICK,
    ])
    .optional(),
  category: z
    .union([
      z.enum([
        ISSUE_CATEGORIES.MISSING_CASE,
        ISSUE_CATEGORIES.WRONG_ASSUMPTION,
        ISSUE_CATEGORIES.SCOPE_CREEP,
        ISSUE_CATEGORIES.AMBIGUITY,
        ISSUE_CATEGORIES.DEPENDENCY_GAP,
        ISSUE_CATEGORIES.SECURITY_GAP,
        ISSUE_CATEGORIES.PERFORMANCE_GAP,
        ISSUE_CATEGORIES.IMPLEMENTATION,
        ISSUE_CATEGORIES.INTEGRATION_CONFLICT,
        ISSUE_CATEGORIES.RACE_CONDITION,
        ISSUE_CATEGORIES.INTERFACE_MISMATCH,
      ]),
      z.array(
        z.enum([
          ISSUE_CATEGORIES.MISSING_CASE,
          ISSUE_CATEGORIES.WRONG_ASSUMPTION,
          ISSUE_CATEGORIES.SCOPE_CREEP,
          ISSUE_CATEGORIES.AMBIGUITY,
          ISSUE_CATEGORIES.DEPENDENCY_GAP,
          ISSUE_CATEGORIES.SECURITY_GAP,
          ISSUE_CATEGORIES.PERFORMANCE_GAP,
          ISSUE_CATEGORIES.IMPLEMENTATION,
          ISSUE_CATEGORIES.INTEGRATION_CONFLICT,
          ISSUE_CATEGORIES.RACE_CONDITION,
          ISSUE_CATEGORIES.INTERFACE_MISMATCH,
        ])
      ),
    ])
    .optional(),
};

function formatToolResult(data: unknown): CallToolResult {
  return createTextToolResult(JSON.stringify(data, null, 2));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
}

const addIssueTool = defineTool({
  name: 'blueprint_add_issue',
  description: 'Create an issue for a plan or build cycle.',
  inputSchema: addIssueInputSchema,
  handler: async (args): Promise<CallToolResult> => {
    try {
      const issue = addIssue({
        parent_type: args.parent_type,
        parent_id: args.parent_id,
        fu_id: args.fu_id,
        ac_id: args.ac_id,
        related_fu_id: args.related_fu_id,
        category: args.category,
        severity: args.severity,
        title: args.title,
        description: args.description,
        suggested_fix: args.suggested_fix,
      });

      return formatToolResult(issue);
    } catch (error: unknown) {
      return createToolErrorResult(getErrorMessage(error));
    }
  },
});

const resolveIssueTool = defineTool({
  name: 'blueprint_resolve_issue',
  description: 'Resolve an issue or mark it as wont_fix.',
  inputSchema: resolveIssueInputSchema,
  handler: async (args): Promise<CallToolResult> => {
    try {
      const issue = resolveIssue({
        issue_id: args.issue_id,
        status: args.status,
        resolved_in: args.resolved_in,
        resolution_note: args.resolution_note,
      });

      return formatToolResult(issue);
    } catch (error: unknown) {
      return createToolErrorResult(getErrorMessage(error));
    }
  },
});

const listIssuesTool = defineTool({
  name: 'blueprint_list_issues',
  description: 'List issues with feature, status, severity, and category filters.',
  inputSchema: listIssuesInputSchema,
  handler: async (args): Promise<CallToolResult> => {
    try {
      const issues = listIssues({
        feature_id: args.feature_id,
        status: args.status,
        severity: args.severity,
        category: args.category,
      });

      return formatToolResult(issues);
    } catch (error: unknown) {
      return createToolErrorResult(getErrorMessage(error));
    }
  },
});

export const issueToolDefinitions: Array<BlueprintToolDefinition> = [
  addIssueTool,
  resolveIssueTool,
  listIssuesTool,
];
