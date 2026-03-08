import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Implementation } from '@modelcontextprotocol/sdk/types.js';

import { getToolDefinitions, registerTools } from './tools/index.js';
import type { BlueprintToolDefinition } from './tools/types.js';

const DEFAULT_SERVER_INFO: Implementation = {
  name: 'blueprint',
  version: '0.1.0',
};

export interface BlueprintServerOptions {
  readonly serverInfo?: Implementation;
  readonly tools?: Array<BlueprintToolDefinition>;
}

export interface BlueprintServerRuntime {
  readonly server: McpServer;
  readonly transport: StdioServerTransport;
  readonly registeredToolNames: Array<string>;
  readonly stop: () => Promise<void>;
}

function resolveServerInfo(serverInfo?: Implementation): Implementation {
  if (serverInfo === undefined) {
    return DEFAULT_SERVER_INFO;
  }

  return serverInfo;
}

function resolveTools(
  tools?: Array<BlueprintToolDefinition>
): Array<BlueprintToolDefinition> {
  if (tools === undefined) {
    return getToolDefinitions();
  }

  return tools;
}

export function createBlueprintServer(options: BlueprintServerOptions = {}): McpServer {
  const serverInfo = resolveServerInfo(options.serverInfo);
  const tools = resolveTools(options.tools);
  const server = new McpServer(serverInfo);

  registerTools(server, tools);

  return server;
}

export async function startBlueprintServer(
  options: BlueprintServerOptions = {}
): Promise<BlueprintServerRuntime> {
  const serverInfo = resolveServerInfo(options.serverInfo);
  const tools = resolveTools(options.tools);
  const server = new McpServer(serverInfo);
  const registeredToolNames = registerTools(server, tools);
  const transport = new StdioServerTransport();

  console.error(
    `Starting ${serverInfo.name} MCP server v${serverInfo.version} with ${registeredToolNames.length} tool(s)`
  );

  try {
    await server.connect(transport);
    console.error(`${serverInfo.name} MCP server connected via stdio`);
  } catch (error: unknown) {
    console.error(`${serverInfo.name} MCP server failed to start`, error);

    throw error;
  }

  let didStop = false;

  async function stop(): Promise<void> {
    if (didStop) {
      return;
    }

    didStop = true;

    try {
      await server.close();
    } finally {
      await transport.close();
    }
  }

  return {
    server,
    transport,
    registeredToolNames,
    stop,
  };
}
