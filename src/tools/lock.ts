import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import {
  blueprintHeartbeat,
  blueprintReleaseLock,
} from '../db/queries/lock.js';
import {
  createTextToolResult,
  createToolErrorResult,
  defineTool,
  type BlueprintToolDefinition,
} from './types.js';

const heartbeatTool = defineTool({
  name: 'blueprint_heartbeat',
  description: 'Refresh the heartbeat for an active work lock.',
  inputSchema: {
    lock_id: z.string().min(1),
    agent_id: z.string().min(1),
  },
  handler: async (args): Promise<CallToolResult> => {
    try {
      const workLock = blueprintHeartbeat({
        lock_id: args.lock_id,
        agent_id: args.agent_id,
      });

      return createTextToolResult(JSON.stringify(workLock, null, 2));
    } catch (error: unknown) {
      return createToolErrorResult(getErrorMessage(error));
    }
  },
});

const releaseLockTool = defineTool({
  name: 'blueprint_release_lock',
  description: 'Release an active work lock owned by an agent.',
  inputSchema: {
    lock_id: z.string().min(1),
    agent_id: z.string().min(1),
    reason: z.string().min(1).optional(),
  },
  handler: async (args): Promise<CallToolResult> => {
    try {
      const workLock = blueprintReleaseLock({
        lock_id: args.lock_id,
        agent_id: args.agent_id,
        reason: args.reason,
      });

      return createTextToolResult(JSON.stringify(workLock, null, 2));
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

export const lockToolDefinitions: Array<BlueprintToolDefinition> = [
  heartbeatTool,
  releaseLockTool,
];
