// Live check through the real stdio protocol. Run: FLIPZI_API_KEY=fz_live_... npm run smoke
// Spends about 7 units on a sandbox key (movers is skipped unless SMOKE_MOVERS=1: 5 units).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const key = process.env.FLIPZI_API_KEY;
if (!key) { console.error('Set FLIPZI_API_KEY to run the live smoke test.'); process.exit(2); }
const client = new Client({ name: 'smoke', version: '0' });
await client.connect(new StdioClientTransport({ command: 'node', args: ['dist/src/index.js'], env: { ...process.env, FLIPZI_API_KEY: key } }));
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content[0].text;
  console.log(`${r.isError ? 'REFUSED' : 'OK     '} ${name} ${JSON.stringify(args)}\n        ${text.split('\n')[0].slice(0, 160)}`);
  return { r, text };
};
const tools = (await client.listTools()).tools;
console.log(`${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`);
const acct = JSON.parse((await call('flipzi_account')).text);
console.log(`plan=${acct.plan} remaining=${acct.units_remaining}`);
const games = await call('flipzi_list_games');
const search = await call('flipzi_search_cards', { q: 'umbreon', game: 'pokemon', page_size: 3 });
const id = JSON.parse(search.text.split('\n')[0]).data[0].id;
await call('flipzi_get_card', { card_id: id });
await call('flipzi_get_price', { card_id: id });
const gated = [['flipzi_get_history', { card_id: id }], ['flipzi_get_sold_comps', { card_id: id }]];
if (process.env.SMOKE_MOVERS === '1') gated.push(['flipzi_get_movers', { game: 'pokemon', limit: 3 }]);
const expected = { flipzi_get_history: 'basic', flipzi_get_sold_comps: 'pro', flipzi_get_movers: 'ultra' };
let bad = 0;
for (const [n, a] of gated) {
  const { r } = await call(n, a);
  const should = acct.tools.find((t) => t.tool === n)?.available;
  if (should === true && r.isError) { console.error(`  MISMATCH: plan ${acct.plan} should allow ${n}`); bad++; }
  if (should === false && !r.isError) { console.error(`  MISMATCH: plan ${acct.plan} should refuse ${n} (needs ${expected[n]})`); bad++; }
}
await client.close();
console.log(bad ? `FAILED (${bad} mismatches)` : 'SMOKE PASSED');
process.exit(bad ? 1 : 0);
