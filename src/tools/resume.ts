import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { blueprintResume } from '../db/queries/resume.js';
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

const resumeTool = defineTool({
  name: 'blueprint_resume',
  description: 'Return the active feature context needed to resume work.',
  inputSchema: {
    agent_id: z.string().min(1).optional(),
  },
  handler: async (args): Promise<CallToolResult> => {
    try {
      const result = blueprintResume({
        agent_id: args.agent_id,
      });

      return formatToolResult(result);
    } catch (error: unknown) {
      return createToolErrorResult(getErrorMessage(error));
    }
  },
});

export const resumeToolDefinitions: Array<BlueprintToolDefinition> = [resumeTool];
