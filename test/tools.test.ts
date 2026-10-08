import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Budget } from '../src/budget.js';
import { FlipziClient } from '../src/client.js';
import { buildTools } from '../src/tools.js';
import { tag } from '../src/links.js';

const ID = '01a10d77-b8c4-7ddf-afdd-5f80f642f266';
const KEY = 'fz_live_SECRETSECRETSECRETSECRET';

type Call = { url: string; headers: Record<string, string> };
function rig(responses: Array<{ status?: number; body?: any; headers?: Record<string, string> }>, o: { key?: string | undefined; max?: number; tagClient?: boolean } = {}) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  let i = 0;
  const fetchImpl = (async (url: any, init: any) => {
    calls.push({ url: String(url), headers: init.headers });
    const r = responses[Math.min(i++, responses.length - 1)];
    return new Response(JSON.stringify(r.body ?? { data: {} }), { status: r.status ?? 200, headers: { 'content-type': 'application/json', ...(r.headers ?? {}) } });
  }) as typeof fetch;
  const client = new FlipziClient({
    apiKey: 'key' in o ? o.key : KEY, budget: new Budget(o.max ?? 150), fetchImpl, tagClient: o.tagClient,
    sleep: async (ms) => { sleeps.push(ms); },
  });
  const tools = Object.fromEntries(buildTools(client).map((t) => [t.name, t]));
  return { calls, sleeps, client, tools };
}
const lockedBody = (extra: any = {}) => ({
  error: { code: 'PLAN_FEATURE_LOCKED', message: "Your plan does not include 'sold_comps'.", request_id: 'rid-1',
    details: { your_plan: 'sandbox', next_plan: 'pro', upgrade_url: 'https://flipzi.io/account/billing?product=data&plan=pro', ...extra } },
});

test('every tool maps to the documented route and params', async () => {
  const cases: Array<[string, any, string]> = [
    ['flipzi_list_games', {}, '/v1/catalog/games'],
    ['flipzi_list_sets', { game: 'pokemon' }, '/v1/catalog/sets?game=pokemon&page_size=25'],
    ['flipzi_list_set_cards', { set_id: 'sv03', game: 'pokemon' }, '/v1/catalog/sets/sv03/cards?game=pokemon&page_size=25'],
    ['flipzi_search_cards', { q: 'umbreon', game: 'pokemon' }, '/v1/cards/search?q=umbreon&game=pokemon&page_size=10'],
    ['flipzi_get_card', { card_id: ID }, `/v1/cards/${ID}`],
    ['flipzi_get_price', { card_id: ID, currency: 'usd' }, `/v1/cards/${ID}/price?currency=usd`],
    ['flipzi_get_sold_comps', { card_id: ID }, `/v1/cards/${ID}/sold`],
    ['flipzi_get_history', { card_id: ID, period: '90d' }, `/v1/cards/${ID}/history?period=90d`],
    ['flipzi_get_movers', { game: 'pokemon', window: '24h' }, '/v1/market/movers?game=pokemon&window=24h&limit=10'],
    ['flipzi_get_box_value', {}, '/v1/sealed/comparisons?game=pokemon'],
    ['flipzi_get_box_value', { set: 'paldea-evolved', history_days: 30 }, '/v1/sealed/comparisons/paldea-evolved?history_days=30'],
    ['flipzi_account', {}, '/v1/meta/usage'],
  ];
  for (const [name, args, path] of cases) {
    const { calls, tools } = rig([{ body: { data: [], plan: 'ultra', used: 1, limit: 500, remaining: 499 } }]);
    const out = await tools[name].run(args);
    assert.equal(out.isError ?? false, false, name);
    assert.equal(calls[0].url, 'https://data.flipzi.io' + path, name);
  }
});

test('sends key and the disclosed client tag; tag can be switched off', async () => {
  let r = rig([{}]);
  await r.tools.flipzi_list_games.run({});
  assert.equal(r.calls[0].headers['X-API-Key'], KEY);
  assert.match(r.calls[0].headers['X-Flipzi-Client'], /^mcp\/\d/);
  r = rig([{}], { tagClient: false });
  await r.tools.flipzi_list_games.run({});
  assert.equal(r.calls[0].headers['X-Flipzi-Client'], undefined);
});

test('plan lock: names the plan, links the upgrade with UTMs, says it cost nothing', async () => {
  const { tools } = rig([{ status: 403, body: lockedBody() }]);
  const out = await tools.flipzi_get_sold_comps.run({ card_id: ID });
  assert.equal(out.isError, true);
  assert.match(out.text, /pro plan/);
  assert.match(out.text, /utm_source=mcp/);
  assert.match(out.text, /utm_medium=integration/);
  assert.match(out.text, /utm_content=flipzi_get_sold_comps/);
  assert.match(out.text, /plan=pro/);
  assert.match(out.text, /0 units/);
});

test('plan lock with no purchasable upgrade does not invent one', async () => {
  const { tools } = rig([{ status: 403, body: { error: { code: 'PLAN_FEATURE_LOCKED', message: 'no', details: { your_plan: 'basic_legacy', upgrade_available: false } } } }]);
  const out = await tools.flipzi_get_sold_comps.run({ card_id: ID });
  assert.match(out.text, /No purchasable plan/);
});

test('history depth, quota and rate limit messages', async () => {
  let r = rig([{ status: 403, body: { error: { code: 'PLAN_DEPTH_EXCEEDED', message: 'x', details: { your_history_depth: '30d', requested_period: '1y' } } } }]);
  assert.match((await r.tools.flipzi_get_history.run({ card_id: ID, period: '1y' })).text, /30d.*1y.*shorter period/s);
  r = rig([{ status: 429, headers: { 'retry-after': '99999' }, body: { error: { code: 'QUOTA_EXCEEDED', message: 'x', details: { used: 500, limit: 500, resets_at: '2026-11-01T00:00:00Z' } } } }]);
  const q = await r.tools.flipzi_get_card.run({ card_id: ID });
  assert.match(q.text, /500 of 500/); assert.match(q.text, /2026-11-01/); assert.equal(r.calls.length, 1);
  r = rig([{ status: 429, headers: { 'retry-after': '60' }, body: { error: { code: 'RATE_LIMITED', message: 'x', details: { limit_per_min: 5 } } } }]);
  const l = await r.tools.flipzi_get_card.run({ card_id: ID });
  assert.match(l.text, /5 requests\/minute/); assert.match(l.text, /60s/); assert.equal(r.calls.length, 1, 'long waits are reported, not slept');
});

test('short rate limit is waited out once and retried', async () => {
  const { tools, calls, sleeps } = rig([
    { status: 429, headers: { 'retry-after': '3' }, body: { error: { code: 'RATE_LIMITED', message: 'x', details: {} } } },
    { body: { data: { ok: 1 } } },
  ]);
  const out = await tools.flipzi_get_card.run({ card_id: ID });
  assert.equal(out.isError ?? false, false);
  assert.equal(calls.length, 2); assert.deepEqual(sleeps, [3000]);
});

test('no key: explains setup, sends no request', async () => {
  const { tools, calls } = rig([{}], { key: undefined });
  for (const n of ['flipzi_list_games', 'flipzi_account']) {
    const out = await tools[n].run({});
    assert.equal(out.isError, true);
    assert.match(out.text, /FLIPZI_API_KEY/); assert.match(out.text, /utm_source=mcp/); assert.match(out.text, /account\/register\?product=data/);
  }
  assert.equal(calls.length, 0);
});

test('invalid key points to the keys page', async () => {
  const { tools } = rig([{ status: 401, body: { error: { code: 'API_KEY_INVALID', message: 'bad', request_id: 'r9', details: {} } } }]);
  const out = await tools.flipzi_list_games.run({});
  assert.match(out.text, /account\/keys/); assert.match(out.text, /r9/);
});

test('session budget stops runaway loops locally; refusals are not charged', async () => {
  const { tools, calls, client } = rig([{ body: { data: [] } }], { max: 6 });
  assert.equal((await tools.flipzi_get_movers.run({ game: 'pokemon' })).isError ?? false, false); // 5 units
  const blocked = await tools.flipzi_get_movers.run({ game: 'pokemon' });
  assert.equal(blocked.isError, true); assert.match(blocked.text, /FLIPZI_MCP_MAX_UNITS/);
  assert.equal(calls.length, 1); assert.equal(client.budget.used, 5);
  const r2 = rig([{ status: 403, body: lockedBody() }], { max: 6 });
  await r2.tools.flipzi_get_movers.run({ game: 'pokemon' });
  assert.equal(r2.client.budget.used, 0);
});

test('malformed card id never reaches the API', async () => {
  const { tools, calls } = rig([{}]);
  const out = await tools.flipzi_get_price.run({ card_id: 'charizard' });
  assert.equal(out.isError, true); assert.match(out.text, /flipzi_search_cards/); assert.equal(calls.length, 0);
});

test('large output is truncated with a hint; slim search rows', async () => {
  const big = { data: Array.from({ length: 2000 }, (_, i) => ({ id: String(i), name: 'x'.repeat(50), game: 'g', set: {}, number: '1', rarity: 'c', image_url: 'u', slug: 's' })) };
  const { tools } = rig([{ body: big }]);
  const out = await tools.flipzi_search_cards.run({ q: 'x' });
  assert.match(out.text, /truncated at 20KB/); assert.doesNotMatch(out.text, /image_url/);
});

test('the key never appears in any output', async () => {
  const bodies = [{ status: 401, body: { error: { code: 'API_KEY_INVALID', message: 'bad', details: {} } } }, { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'boom', details: {} } } }, {}];
  for (const b of bodies) {
    const { tools } = rig([b]);
    for (const t of Object.values(tools)) { const o = await t.run({ card_id: ID, q: 'a', game: 'g', set_id: 's' }); assert.ok(!o.text.includes('SECRET')); }
  }
});

test('flipzi_account marks what the plan unlocks and offers upgrade only when one exists', async () => {
  const sandbox = rig([{ body: { plan: 'sandbox', used: 3, limit: 500, remaining: 497, resets_in_s: 86400 * 10 } }]);
  const a = JSON.parse((await sandbox.tools.flipzi_account.run({})).text);
  const by = Object.fromEntries(a.tools.map((t: any) => [t.tool, t]));
  assert.equal(by.flipzi_get_price.available, true); assert.equal(by.flipzi_get_sold_comps.available, false);
  assert.equal(by.flipzi_get_sold_comps.needs, 'pro'); assert.equal(by.flipzi_get_box_value.needs, 'pro'); assert.equal(by.flipzi_get_box_value.available, false); assert.equal(by.flipzi_get_movers.needs, 'ultra'); assert.ok(a.upgrade);
  const mega = rig([{ body: { plan: 'mega', used: 3, limit: 1000000, remaining: 999997 } }]);
  const m = JSON.parse((await mega.tools.flipzi_account.run({})).text);
  assert.ok(m.tools.every((t: any) => t.available)); assert.equal(m.upgrade, undefined);
  const legacy = rig([{ body: { plan: 'pro_legacy', used: 3, limit: 420000, remaining: 1 } }]);
  const l = JSON.parse((await legacy.tools.flipzi_account.run({})).text);
  assert.equal(l.tools.find((t: any) => t.tool === 'flipzi_get_sold_comps').available, null, 'unknown ladder: do not guess');
  assert.equal(l.upgrade, undefined);
});

test('tool descriptions carry plan + unit cost from the generated spec data', () => {
  const { tools } = rig([{}]);
  assert.match(tools.flipzi_get_sold_comps.description, /pro plan or higher.*1 unit/s);
  assert.match(tools.flipzi_get_movers.description, /ultra plan or higher.*5 units/s);
  assert.match(tools.flipzi_search_cards.description, /free plan/);
});

test('links: only flipzi.io is tagged', () => {
  assert.equal(tag('https://example.com/x'), 'https://example.com/x');
  assert.match(tag('https://flipzi.io/a?plan=pro', 'Weird Value!'), /utm_content=weird-value-/);
});

test('plans.generated.ts matches api-data/openapi.yaml when it is available', () => {
  execFileSync('node', ['scripts/gen-plans.mjs', '--check'], { stdio: 'pipe' });
});

test('README documents every tool', async () => {
  const { readFileSync } = await import('node:fs');
  const readme = readFileSync('README.md', 'utf8');
  for (const t of buildTools(rig([{}]).client)) assert.ok(readme.includes('`' + t.name + '`'), t.name);
});
