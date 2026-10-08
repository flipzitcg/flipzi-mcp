// Builds dist-mcpb/flipzi-mcp.mcpb: a one-click Claude Desktop extension (also what Smithery
// takes for local servers). Single esbuild bundle, so no node_modules ship inside.
// Run: npm run build:mcpb   (needs network the first time for @anthropic-ai/mcpb)
import { build } from 'esbuild';
import { mkdirSync, rmSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { OPS } from '../dist/src/plans.generated.js';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
rmSync('dist-mcpb', { recursive: true, force: true });
mkdirSync('dist-mcpb/stage/server', { recursive: true });
await build({
  entryPoints: ['dist/src/index.js'], bundle: true, platform: 'node', format: 'esm', target: 'node18',
  outfile: 'dist-mcpb/stage/server/index.js',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
const tools = [
  ['flipzi_account', 'Your plan, allowance used and which tools your plan unlocks'],
  ['flipzi_list_games', 'Supported games'], ['flipzi_list_sets', 'Sets of a game'], ['flipzi_list_set_cards', 'Cards in a set'],
  ['flipzi_search_cards', 'Search cards by name'], ['flipzi_get_card', 'Card details'], ['flipzi_get_price', 'Current price'],
  ['flipzi_get_history', 'Price history (Basic+)'], ['flipzi_get_sold_comps', 'Sold comparisons (Pro+)'], ['flipzi_get_movers', 'Market movers (Ultra)'],
].map(([name, description]) => ({ name, description }));
const manifest = {
  manifest_version: '0.3', name: 'flipzi', display_name: 'Flipzi Card Prices', version: pkg.version,
  description: 'Trading card prices, sold comps, history and movers from the Flipzi Data API. Bring your own key; free plan available.',
  author: { name: 'Flipzi', url: 'https://flipzi.io' }, homepage: 'https://flipzi.io/api/guides/mcp-server/', license: 'MIT',
  server: { type: 'node', entry_point: 'server/index.js', mcp_config: { command: 'node', args: ['${__dirname}/server/index.js'], env: { FLIPZI_API_KEY: '${user_config.api_key}' } } },
  user_config: { api_key: { type: 'string', title: 'Flipzi API key', description: 'Starts with fz_live_. Free key: flipzi.io/account (no card).', sensitive: true, required: true } },
  tools,
};
writeFileSync('dist-mcpb/stage/manifest.json', JSON.stringify(manifest, null, 2));
copyFileSync('LICENSE', 'dist-mcpb/stage/LICENSE');
execFileSync('npx', ['-y', '@anthropic-ai/mcpb', 'validate', 'dist-mcpb/stage/manifest.json'], { stdio: 'inherit' });
execFileSync('npx', ['-y', '@anthropic-ai/mcpb', 'pack', 'dist-mcpb/stage', 'dist-mcpb/flipzi-mcp.mcpb'], { stdio: 'inherit' });
console.log('spec ops:', Object.keys(OPS).length);
