import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import {
  createFeature,
  getFullFeatureById,
  listFeatures,
} from '../db/queries/feature.js';
import { FEATURE_PRIORITIES, FEATURE_STATUSES } from '../entities/types.js';
import {
  createTextToolResult,
  createToolErrorResult,
  defineTool,
  type BlueprintToolDefinition,
  type BlueprintToolDefinitionWithInput,
} from './types.js';

const createFeatureInputSchema = {
  title: z.string().min(1),
  scope: z.string().min(1),
  out_of_scope: z.string(),
  priority: z.enum([
    FEATURE_PRIORITIES.P0,
    FEATURE_PRIORITIES.P1,
    FEATURE_PRIORITIES.P2,
  ]),
  depends_on: z.array(z.string().min(1)).optional(),
};

const listFeaturesInputSchema = {
  status: z
    .enum([
      FEATURE_STATUSES.DRAFT,
      FEATURE_STATUSES.PLAN_REVIEW,
      FEATURE_STATUSES.BUILDING,
      FEATURE_STATUSES.BUILD_REVIEW,
      FEATURE_STATUSES.DONE,
    ])
    .optional(),
};

const getFeatureInputSchema = {
  feature_id: z.string().min(1),
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

const createFeatureTool = defineTool({
  name: 'blueprint_create_feature',
  description: 'Create a feature with validated dependencies and priority.',
  inputSchema: createFeatureInputSchema,
  handler: async (args): Promise<CallToolResult> => {
    try {
      const feature = createFeature({
        title: args.title,
        scope: args.scope,
        out_of_scope: args.out_of_scope,
        priority: args.priority,
        depends_on: args.depends_on,
      });

      return formatToolResult(feature);
    } catch (error: unknown) {
      return createToolErrorResult(getErrorMessage(error));
    }
  },
});

const listFeaturesTool = defineTool({
  name: 'blueprint_list_features',
  description: 'List features, optionally filtered by status.',
  inputSchema: listFeaturesInputSchema,
  handler: async (args): Promise<CallToolResult> => {
    try {
      const features = listFeatures({ status: args.status });

      return formatToolResult(features);
    } catch (error: unknown) {
      return createToolErrorResult(getErrorMessage(error));
    }
  },
});

const getFeatureTool = defineTool({
  name: 'blueprint_get_feature',
  description: 'Get a feature with its function units and acceptance criteria.',
  inputSchema: getFeatureInputSchema,
  handler: async (args): Promise<CallToolResult> => {
    try {
      const feature = getFullFeatureById(args.feature_id);

      if (feature === null) {
        return createToolErrorResult(`Feature not found: ${args.feature_id}`);
      }

      return formatToolResult(feature);
    } catch (error: unknown) {
      return createToolErrorResult(getErrorMessage(error));
    }
  },
});

export const featureTools: Array<BlueprintToolDefinition> = [
  createFeatureTool,
  listFeaturesTool,
  getFeatureTool,
];
