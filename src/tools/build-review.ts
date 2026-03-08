import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { submitBuildForReview } from '../db/queries/build-review.js';
import {
  createTextToolResult,
  createToolErrorResult,
  defineTool,
  type BlueprintToolDefinition,
} from './types.js';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
}

function formatToolResult(data: unknown): CallToolResult {
  return createTextToolResult(JSON.stringify(data, null, 2));
}

const submitForReviewTool = defineTool({
  name: 'blueprint_submit_for_review',
  description: 'Submit an active build cycle for review once all work is complete.',
  inputSchema: {
    build_cycle_id: z.string().min(1),
  },
  handler: async (args): Promise<CallToolResult> => {
    try {
      const result = submitBuildForReview({
        build_cycle_id: args.build_cycle_id,
      });

      return formatToolResult(result);
    } catch (error: unknown) {
      return createToolErrorResult(getErrorMessage(error));
    }
  },
});

export const buildReviewToolDefinitions: Array<BlueprintToolDefinition> = [
  submitForReviewTool,
];
