#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { budgetFromEnv } from './budget.js';
import { FlipziClient, VERSION } from './client.js';
import { buildTools } from './tools.js';

const key = process.env.FLIPZI_API_KEY?.trim();
const client = new FlipziClient({
  apiKey: key || undefined,
  baseUrl: process.env.FLIPZI_API_BASE,
  budget: budgetFromEnv(process.env),
  tagClient: process.env.FLIPZI_MCP_NO_CLIENT_TAG !== '1',
});

const server = new McpServer({ name: 'flipzi', version: VERSION });
for (const t of buildTools(client)) {
  server.registerTool(
    t.name,
    { title: t.title, description: t.description, inputSchema: t.shape, annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true } },
    async (args: any) => {
      const out = await t.run(args);
      return { content: [{ type: 'text' as const, text: out.text }], isError: out.isError ?? false };
    },
  );
}
// stdout is the protocol channel: diagnostics go to stderr only, and never include the key.
console.error(`flipzi-mcp ${VERSION} ready (${key ? 'key set' : 'NO KEY: tools will explain how to get one'})`);
await server.connect(new StdioServerTransport());
