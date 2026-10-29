import { z } from 'zod';
import { ApiError, FlipziClient, Meta, Result } from './client.js';
import { keysUrl, signupUrl, tag, pricingUrl } from './links.js';
import { OPS } from './plans.generated.js';
import { planText, unitsOf, unitsText, unlocked, rank } from './plans.js';

export interface ToolOut { text: string; isError?: boolean }
export interface ToolDef {
  name: string;
  op: string; // openapi operationId, the plan requirement is read from it
  title: string;
  description: string;
  shape: z.ZodRawShape;
  run(args: any): Promise<ToolOut>;
}

const MAX_CHARS = 20000;
const uuid = z.string().describe('Flipzi card id (UUID). Get it from flipzi_search_cards or flipzi_list_set_cards.');
const currency = z.enum(['eur', 'usd']).optional().describe('Default eur.');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ok(data: any, meta: Meta, client: FlipziClient): ToolOut {
  const footer: Record<string, unknown> = {};
  if (meta.quotaRemaining !== undefined) footer.monthly_units_remaining_before_this_call = meta.quotaRemaining;
  if (client.budget.max > 0) footer.mcp_session_units_used = `${client.budget.used}/${client.budget.max}`;
  let text = JSON.stringify(data);
  let note = '';
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS);
    note = '\n[output truncated at 20KB: narrow the query (smaller page_size, a game or set filter)]';
  }
  return { text: text + note + '\n' + JSON.stringify({ _flipzi: footer }) };
}

export function fail(e: ApiError, tool: string): ToolOut {
  const d = e.details ?? {};
  const rid = e.requestId ? ` (request_id ${e.requestId})` : '';
  const up = (url: string) => tag(url, tool);
  let msg: string;
  switch (e.code) {
    case 'PLAN_FEATURE_LOCKED': {
      const need = d.next_plan ? `The ${d.next_plan} plan includes it.` : 'No purchasable plan adds it for your account.';
      msg = `Not on your plan. ${e.message} Your plan: ${d.your_plan ?? 'unknown'}. ${need}` +
        (d.upgrade_url ? ` Upgrade: ${up(d.upgrade_url)}` : ` Plans: ${pricingUrl(tool)}`) +
        ' Your other tools keep working, and this refusal cost 0 units.';
      break;
    }
    case 'PLAN_DEPTH_EXCEEDED':
      msg = `Your plan's history depth is ${d.your_history_depth ?? 'limited'}; you asked for ${d.requested_period ?? 'more'}. Retry with a shorter period.` +
        (d.upgrade_url ? ` Longer history: ${up(d.upgrade_url)}` : '') + ' (0 units charged)';
      break;
    case 'QUOTA_EXCEEDED':
      msg = `Monthly allowance used up: ${d.used ?? '?'} of ${d.limit ?? '?'} units; resets ${d.resets_at ?? 'on the 1st (UTC)'}.` +
        (d.upgrade_url ? ` More units: ${up(d.upgrade_url)}` : ` Plans: ${pricingUrl(tool)}`);
      break;
    case 'RATE_LIMITED':
      msg = `Rate limit hit (${d.limit_per_min ?? '?'} requests/minute on your plan). Wait ${e.retryAfter ?? d.retry_after ?? 60}s and retry.` +
        (d.upgrade_url ? ` Higher limits: ${up(d.upgrade_url)}` : '');
      break;
    case 'API_KEY_INVALID':
      msg = `The API key was rejected${rid}. Check FLIPZI_API_KEY (it starts with fz_live_), or create a key: ${keysUrl(tool)}`;
      break;
    case 'API_KEY_REQUIRED':
      msg = `No API key was accepted. Create a free account and key: ${signupUrl(tool)}`;
      break;
    case 'CARD_NOT_FOUND': case 'INVALID_UUID':
      msg = `${e.message} Use flipzi_search_cards to find a valid card id.`;
      break;
    default:
      msg = `${e.code}: ${e.message}`;
  }
  return { text: msg + (msg.includes('request_id') ? '' : rid), isError: true };
}

const slim = (c: any) => ({ id: c.id, name: c.name, game: c.game, set: c.set, number: c.number, rarity: c.rarity, printing: c.printing_label ?? c.printing ?? undefined });

export function buildTools(client: FlipziClient): ToolDef[] {
  const call = async (
    name: string, op: string, path: string, query: Record<string, any>,
    map: (d: any) => any = (d) => d,
  ): Promise<ToolOut> => {
    if (!client.hasKey) {
      return {
        isError: true,
        text: 'FLIPZI_API_KEY is not set. Flipzi is bring-your-own-key; the free plan needs no card.\n' +
          `1. Create a free account: ${signupUrl(name)}\n2. Create a key: ${keysUrl(name)}\n` +
          '3. Put it in this server\'s env as FLIPZI_API_KEY and restart your AI tool.',
      };
    }
    const r: Result = await client.get(path, query, unitsOf(op));
    return r.ok ? ok(map(r.data), r.meta, client) : fail(r.error, name);
  };
  const T = (name: string, op: string, title: string, what: string, shape: z.ZodRawShape,
    build: (a: any) => { path: string; query: Record<string, any>; map?: (d: any) => any }): ToolDef => ({
    name, op, title,
    description: `${what} ${planText(op)} Cost: ${unitsText(op)}.`,
    shape,
    async run(args: any) {
      const b = build(args);
      return call(name, op, b.path, b.query, b.map);
    },
  });
  const cardPath = (a: any, suffix = '') => `/v1/cards/${encodeURIComponent(a.card_id)}${suffix}`;
  const withCard = (name: string, op: string, title: string, what: string, extra: z.ZodRawShape,
    build: (a: any) => { path: string; query: Record<string, any> }): ToolDef => {
    const t = T(name, op, title, what, { card_id: uuid, ...extra }, build);
    const run = t.run;
    t.run = async (a: any) => UUID_RE.test(String(a.card_id ?? ''))
      ? run(a)
      : { isError: true, text: 'card_id must be a Flipzi card UUID. Call flipzi_search_cards (or flipzi_list_set_cards) first and use the "id" it returns.' };
    return t;
  };

  const tools: ToolDef[] = [
    {
      name: 'flipzi_account', op: 'getUsage', title: 'Flipzi plan and allowance',
      description: 'Shows your Flipzi plan, units used this month and which of these tools your plan unlocks. Free (0 units); works even when the allowance is used up. Call this first if unsure what you can do.',
      shape: {},
      async run() {
        if (!client.hasKey) return call('flipzi_account', 'getUsage', '/v1/meta/usage', {});
        const r = await client.get('/v1/meta/usage', {}, 0);
        if (!r.ok) return fail(r.error, 'flipzi_account');
        const u = r.data;
        const tool = (n: string, op: string) => ({ tool: n, needs: OPS[op].min_plan === 'sandbox' ? 'free' : OPS[op].min_plan, available: unlocked(op, u.plan) });
        const ranked = rank(u.plan) >= 0;
        return {
          text: JSON.stringify({
            plan: u.plan, units_used: u.used, units_limit: u.limit, units_remaining: u.remaining,
            resets_in_days: u.resets_in_s ? Math.round(u.resets_in_s / 86400) : undefined,
            mcp_session_units: `${client.budget.used}/${client.budget.max || 'unlimited'}`,
            tools: [
              tool('flipzi_search_cards', 'searchCards'), tool('flipzi_get_card', 'getCard'), tool('flipzi_get_price', 'getCardPrice'),
              tool('flipzi_list_games', 'listGames'), tool('flipzi_list_sets', 'listSets'), tool('flipzi_list_set_cards', 'listSetCards'),
              tool('flipzi_get_history', 'getCardHistory'), tool('flipzi_get_sold_comps', 'getCardSold'), tool('flipzi_get_movers', 'getMarketMovers'),
              tool('flipzi_get_box_value', 'getSealedComparisons'), tool('flipzi_get_cardmarket_conditions', 'getCardCardmarketConditions'),
            ],
            ...(ranked && rank(u.plan) < rank('ultra') ? { upgrade: tag('https://flipzi.io/account/billing?product=data', 'flipzi_account'), pricing: pricingUrl('flipzi_account') } : {}),
          }),
        };
      },
    },
    T('flipzi_list_games', 'listGames', 'List supported games', 'Lists the trading card games Flipzi covers (use the returned ids as `game` elsewhere).', {},
      () => ({ path: '/v1/catalog/games', query: {} })),
    T('flipzi_list_sets', 'listSets', 'List sets for a game', 'Lists the sets of one game, paginated.', {
      game: z.string().describe('Game id from flipzi_list_games, e.g. "pokemon".'),
      page: z.number().int().min(1).optional(), page_size: z.number().int().min(1).max(100).optional().describe('Default 25.'),
    }, (a) => ({ path: '/v1/catalog/sets', query: { game: a.game, page: a.page, page_size: a.page_size ?? 25 } })),
    T('flipzi_list_set_cards', 'listSetCards', 'List cards in a set', 'Lists the cards of one set in number order. Use it to get card ids.', {
      set_id: z.string().describe('set_id from flipzi_list_sets.'), game: z.string().describe('Game id.'),
      page: z.number().int().min(1).optional(), page_size: z.number().int().min(1).max(100).optional().describe('Default 25.'),
    }, (a) => ({
      path: `/v1/catalog/sets/${encodeURIComponent(a.set_id)}/cards`, query: { game: a.game, page: a.page, page_size: a.page_size ?? 25 },
      map: (d: any) => (Array.isArray(d?.data) ? { ...d, data: d.data.map(slim) } : d),
    })),
    T('flipzi_search_cards', 'searchCards', 'Search cards by name', 'Searches cards by name (last word prefix-matched). Returns card ids needed by every price tool.', {
      q: z.string().min(1).describe('Card name, e.g. "charizard".'), game: z.string().optional().describe('Restrict to one game id.'),
      set_id: z.string().optional(), number: z.string().optional().describe('Card number within the set.'),
      lang: z.string().optional().describe('Language code if you need a non-default language.'),
      page: z.number().int().min(1).optional(), page_size: z.number().int().min(1).max(25).optional().describe('Default 10.'),
    }, (a) => ({
      path: '/v1/cards/search', query: { q: a.q, game: a.game, set_id: a.set_id, number: a.number, lang: a.lang, page: a.page, page_size: a.page_size ?? 10 },
      map: (d: any) => (Array.isArray(d?.data) ? { ...d, data: d.data.map(slim) } : d),
    })),
    withCard('flipzi_get_card', 'getCard', 'Card details', 'Card metadata and variants (no prices).', {},
      (a) => ({ path: cardPath(a), query: {} })),
    withCard('flipzi_get_price', 'getCardPrice', 'Current price', 'Current price for a card, with the market it came from and a confidence rating. Raw (ungraded) by default; graded values need the Pro plan.', {
      currency, grade: z.string().optional().describe('e.g. RAW (default) or PSA_10 (Pro+).'),
    }, (a) => ({ path: cardPath(a, '/price'), query: { currency: a.currency, grade: a.grade } })),
    withCard('flipzi_get_sold_comps', 'getCardSold', 'Sold comparisons', 'What buyers actually paid on eBay (blended sold comps) for a card.', {
      currency, grade: z.string().optional(), language: z.string().optional(),
    }, (a) => ({ path: cardPath(a, '/sold'), query: { currency: a.currency, grade: a.grade, language: a.language } })),
    withCard('flipzi_get_cardmarket_conditions', 'getCardCardmarketConditions', 'Cardmarket prices by condition',
      'What Cardmarket sellers ask for a card per language, finish and Cardmarket grade (MT Mint, NM, EX Excellent, GD Good, LP Light Played, PL Played, PO Poor): the cheapest visible offer and the median of the visible offers, in EUR, with the date the page was read. `coverage` says whether there is data: covered, no_offers, stale (older than 60 days, no figure) or not_covered (Pokemon EN/JP and One Piece singles from EUR 2 are covered). Cardmarket grades are not eBay conditions; `us_grade` is only a rough hint. Asking prices, not sales: use flipzi_get_sold_comps for what sold.', {
      language: z.enum(['en', 'ja']).optional().describe('Only this Cardmarket language. Default: every language the card has.'),
      seller_country: z.string().optional().describe('Only offers from sellers in these countries: ISO codes, comma-separated (e.g. "DE" or "DE,AT"), or "eu" for the 27 EU states. The answer then lists seller_country and per-language offers_matched. Default: sellers anywhere.'),
    }, (a) => ({ path: cardPath(a, '/cardmarket'), query: { language: a.language, seller_country: a.seller_country } })),
    withCard('flipzi_get_history', 'getCardHistory', 'Price history', 'Daily price history and summary. Depth depends on plan (Basic 30 days, Pro and above all).', {
      period: z.enum(['7d', '30d', '90d', '6m', '1y', 'all']).optional().describe('Default 30d.'), currency, grade: z.string().optional(),
    }, (a) => ({ path: cardPath(a, '/history'), query: { period: a.period, currency: a.currency, grade: a.grade } })),
    T('flipzi_get_movers', 'getMarketMovers', 'Market movers', 'Biggest price gainers/losers for a game over a window. Costs 5 units per call: use sparingly.', {
      game: z.string().describe('Game id.'), window: z.enum(['24h', '7d', '30d']).optional().describe('Default 7d.'),
      direction: z.enum(['gainers', 'losers', 'both']).optional(), limit: z.number().int().min(1).max(100).optional().describe('Per direction. Default 10.'),
      set_id: z.string().optional(), currency,
    }, (a) => ({ path: '/v1/market/movers', query: { game: a.game, window: a.window, direction: a.direction, limit: a.limit ?? 10, set_id: a.set_id, currency: a.currency } })),
    T('flipzi_get_box_value', 'getSealedComparisons', 'Booster box value', 'Sealed booster-box price vs the ESTIMATED value of the cards inside (English Pokemon boxes that pass Flipzi checks). Values are a low/base/high range at CardMarket EUR prices; pull rates are estimates, so this is not a promise about any one box. Omit `set` to list every published box; pass a box `set` slug (from the list) for its top cards and history.', {
      set: z.string().optional().describe('Box slug from the list, e.g. "paldea-evolved". Omit to list all published boxes.'),
      history_days: z.number().int().min(1).max(365).optional().describe('With `set`: days of history. Default 90.'),
    }, (a) => a.set
      ? { path: `/v1/sealed/comparisons/${encodeURIComponent(a.set)}`, query: { history_days: a.history_days } }
      : { path: '/v1/sealed/comparisons', query: { game: 'pokemon' } }),
  ];
  return tools;
}
