import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import {
  blueprintCheckpoint,
  blueprintCompleteFu,
  blueprintFailFu,
} from '../db/queries/checkpoint.js';
import {
  createTextToolResult,
  createToolErrorResult,
  defineTool,
  type BlueprintToolDefinition,
} from './types.js';

const checkpointTool = defineTool({
  name: 'blueprint_checkpoint',
  description: 'Upsert an agent checkpoint for a build cycle.',
  inputSchema: {
    build_cycle_id: z.string().min(1),
    agent_id: z.string().min(1),
    completed_fu: z.string().min(1).optional(),
    next_fu: z.string().min(1).optional(),
    notes: z.string().min(1).optional(),
  },
  handler: async (args): Promise<CallToolResult> => {
    try {
      const checkpoint = blueprintCheckpoint({
        build_cycle_id: args.build_cycle_id,
        agent_id: args.agent_id,
        completed_fu: args.completed_fu,
        next_fu: args.next_fu,
        notes: args.notes,
      });

      return createTextToolResult(JSON.stringify(checkpoint, null, 2));
    } catch (error: unknown) {
      return createToolErrorResult(getErrorMessage(error));
    }
  },
});

const completeFuTool = defineTool({
  name: 'blueprint_complete_fu',
  description: 'Mark a function unit passed with required evidence.',
  inputSchema: {
    build_cycle_id: z.string().min(1),
    fu_id: z.string().min(1),
    agent_id: z.string().min(1),
    evidence: z.string().min(1),
  },
  handler: async (args): Promise<CallToolResult> => {
    try {
      const functionUnit = blueprintCompleteFu({
        build_cycle_id: args.build_cycle_id,
        fu_id: args.fu_id,
        agent_id: args.agent_id,
        evidence: args.evidence,
      });

      return createTextToolResult(JSON.stringify(functionUnit, null, 2));
    } catch (error: unknown) {
      return createToolErrorResult(getErrorMessage(error));
    }
  },
});

const failFuTool = defineTool({
  name: 'blueprint_fail_fu',
  description: 'Mark a function unit failed with a reason.',
  inputSchema: {
    fu_id: z.string().min(1),
    reason: z.string().min(1),
  },
  handler: async (args): Promise<CallToolResult> => {
    try {
      const functionUnit = blueprintFailFu({
        fu_id: args.fu_id,
        reason: args.reason,
      });

      return createTextToolResult(JSON.stringify(functionUnit, null, 2));
    } catch (error: unknown) {
      return createToolErrorResult(getErrorMessage(error));
    }
  },
});

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
}

export const checkpointToolDefinitions: Array<BlueprintToolDefinition> = [
  checkpointTool,
  completeFuTool,
  failFuTool,
];
