import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import {
  addIntegrationIssue,
  listIntegrationIssues,
} from '../db/queries/issue-integration.js';
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

export const integrationIssueCategorySchema = z.enum([
  ISSUE_CATEGORIES.INTEGRATION_CONFLICT,
  ISSUE_CATEGORIES.RACE_CONDITION,
  ISSUE_CATEGORIES.INTERFACE_MISMATCH,
]);

export const integrationIssueSeveritySchema = z
  .enum([
    ISSUE_SEVERITIES.CRITICAL,
    ISSUE_SEVERITIES.MAJOR,
    ISSUE_SEVERITIES.MINOR,
    ISSUE_SEVERITIES.NITPICK,
  ])
  .optional();

export const addIntegrationIssueInputSchema = {
  parent_type: z.enum([ISSUE_PARENT_TYPES.PLAN, ISSUE_PARENT_TYPES.BUILD]),
  parent_id: z.string().min(1),
  fu_id: z.string().min(1),
  ac_id: z.string().min(1).optional(),
  related_fu_id: z.string().min(1).optional(),
  category: integrationIssueCategorySchema,
  severity: integrationIssueSeveritySchema,
  title: z.string().min(1),
  description: z.string().min(1),
  suggested_fix: z.string().min(1).optional(),
};

export const listIntegrationIssuesInputSchema = {
  feature_id: z.string().min(1).optional(),
  status: z
    .enum([
      ISSUE_STATUSES.OPEN,
      ISSUE_STATUSES.IN_PROGRESS,
      ISSUE_STATUSES.RESOLVED,
      ISSUE_STATUSES.WONT_FIX,
    ])
    .optional(),
  severity: integrationIssueSeveritySchema,
  category: z.union([integrationIssueCategorySchema, z.array(integrationIssueCategorySchema)]).optional(),
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

const addIntegrationIssueTool = defineTool({
  name: 'blueprint_add_integration_issue',
  description: 'Create an integration issue with category-specific validation.',
  inputSchema: addIntegrationIssueInputSchema,
  handler: async (args): Promise<CallToolResult> => {
    try {
      const issue = addIntegrationIssue({
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

const listIntegrationIssuesTool = defineTool({
  name: 'blueprint_list_integration_issues',
  description: 'List issues filtered to integration-specific categories.',
  inputSchema: listIntegrationIssuesInputSchema,
  handler: async (args): Promise<CallToolResult> => {
    try {
      const issues = listIntegrationIssues({
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

export const integrationIssueToolDefinitions: Array<BlueprintToolDefinition> = [
  addIntegrationIssueTool,
  listIntegrationIssuesTool,
];
