import type { ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type BlueprintToolInputSchema = ZodRawShapeCompat;

export interface BlueprintToolDefinitionWithoutInput {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: undefined;
  readonly handler: ToolCallback<undefined>;
}

export interface BlueprintToolDefinitionWithInput<
  TInputSchema extends BlueprintToolInputSchema = BlueprintToolInputSchema,
> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: TInputSchema;
  readonly handler: ToolCallback<TInputSchema>;
}

export type BlueprintToolDefinition =
  | BlueprintToolDefinitionWithoutInput
  | BlueprintToolDefinitionWithInput;

export function defineTool<TInputSchema extends BlueprintToolInputSchema>(
  definition: BlueprintToolDefinitionWithInput<TInputSchema>
): BlueprintToolDefinition;
export function defineTool(
  definition: BlueprintToolDefinitionWithoutInput
): BlueprintToolDefinition;
export function defineTool(
  definition: BlueprintToolDefinition
): BlueprintToolDefinition {
  return definition;
}

export interface BlueprintTextContent {
  readonly type: 'text';
  readonly text: string;
}

export function createTextToolResult(text: string): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
  };
}

export function createToolErrorResult(message: string): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: message,
      },
    ],
    isError: true,
  };
}
