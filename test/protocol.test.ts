import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('real stdio server lists every tool as read-only and explains a missing key', async () => {
  const env = { ...process.env } as Record<string, string>;
  delete env.FLIPZI_API_KEY;
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/src/index.js'], env }));
  const { tools } = await client.listTools();
  assert.equal(tools.length, 10);
  assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true));
  assert.ok(tools.every((t) => t.name.startsWith('flipzi_')));
  const r: any = await client.callTool({ name: 'flipzi_search_cards', arguments: { q: 'umbreon' } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /FLIPZI_API_KEY/);
  await client.close();
});
