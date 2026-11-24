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

const SEALED_TYPES = ['booster_box', 'elite_trainer_box', 'booster_bundle', 'booster_pack', 'blister', 'tin', 'deck', 'collection', 'case', 'accessory', 'other'] as const;
const slimSealed = (p: any) => ({
  id: p.id, name: p.name, game: p.game, type: p.type, set_id: p.set_id,
  prices: Array.isArray(p.prices) ? p.prices.map((x: any) => ({ market: x.market, price: x.price_formatted, updated_at: x.updated_at })) : p.prices,
  cardmarket_offers: p.cardmarket_offers,
});
const slim = (c: any) => ({
  id: c.id, name: c.name, game: c.game, set: c.set, number: c.number, rarity: c.rarity, printing: c.printing_label ?? c.printing ?? undefined,
  // Kept so an agent can see that other printings or finishes of the same card exist.
  printings_count: c.printings_count || undefined, base_card_id: c.base_card_id ?? undefined,
  finishes: Array.isArray(c.finishes) && c.finishes.length ? c.finishes : undefined,
});

// Shared parameters of the sold-comps routes, as openapi.yaml defines them (components/parameters).
const GRADE = z.string().optional().describe('Grade code, e.g. RAW, PSA_10, BGS_9.5. Graded values need the Pro plan.');
const SOLD_LANGUAGES = ['EN', 'JA', 'DE', 'FR', 'IT', 'ES', 'ZH'] as const;
const MARKETPLACES = ['ebay_uk', 'ebay_us', 'ebay_au', 'ebay_ca', 'ebay_de', 'ebay_fr', 'ebay_it', 'ebay_es'] as const;
const finish = z.enum(['standard', 'reverse_holo', 'first_edition']).optional()
  .describe('Which finish to read. Default standard; a finish the card does not have returns an empty result.');
const condition = z.enum(['nm', 'lp', 'mp', 'hp', 'dmg']).optional()
  .describe('Only ungraded copies whose eBay titles state this condition (near mint, lightly/moderately/heavily played, damaged; seller-stated, not verified). Implies grade RAW. Omit for the price across conditions (which leaves out hp and dmg). Pro and above.');
const marketplace = z.enum(MARKETPLACES).optional().describe('Only this eBay site.');
const soldLanguage = (what: string) => z.string().optional().describe(`Listing language: ${SOLD_LANGUAGES.join(', ')}. ${what}`);
const upper = (v: unknown) => (typeof v === 'string' && v ? v.toUpperCase() : undefined);
// The API counts a bulk call by its distinct ids (trimmed, case-insensitive); so does the session budget.
export const distinctIds = (ids: unknown[]): string[] => {
  const seen = new Map<string, string>();
  for (const v of ids) { const s = String(v).trim(); if (s && !seen.has(s.toLowerCase())) seen.set(s.toLowerCase(), s); }
  return [...seen.values()];
};

export function buildTools(client: FlipziClient): ToolDef[] {
  const call = async (
    name: string, op: string, path: string, query: Record<string, any>,
    map: (d: any) => any = (d) => d, post?: { body: unknown; units: number },
  ): Promise<ToolOut> => {
    if (!client.hasKey) {
      return {
        isError: true,
        text: 'FLIPZI_API_KEY is not set. Flipzi is bring-your-own-key; the free plan needs no card.\n' +
          `1. Create a free account: ${signupUrl(name)}\n2. Create a key: ${keysUrl(name)}\n` +
          '3. Put it in this server\'s env as FLIPZI_API_KEY and restart your AI tool.',
      };
    }
    const r: Result = post ? await client.post(path, post.body, post.units) : await client.get(path, query, unitsOf(op));
    return r.ok ? ok(map(r.data), r.meta, client) : fail(r.error, name);
  };
  const T = (name: string, op: string, title: string, what: string, shape: z.ZodRawShape,
    build: (a: any) => { path: string; query: Record<string, any>; map?: (d: any) => any; error?: string }): ToolDef => ({
    name, op, title,
    description: `${what} ${planText(op)} Cost: ${unitsText(op)}.`,
    shape,
    async run(args: any) {
      const b = build(args);
      if (b.error) return { isError: true, text: b.error };
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
              tool('flipzi_search_sealed', 'searchSealed'), tool('flipzi_get_sealed_cardmarket', 'getSealedCardmarket'),
              tool('flipzi_get_box_value', 'getSealedComparisons'), tool('flipzi_get_cardmarket_conditions', 'getCardCardmarketConditions'),
              tool('flipzi_lookup_card', 'lookupCard'), tool('flipzi_get_prices_bulk', 'bulkCardPrices'),
              tool('flipzi_get_marketplace_comps', 'getCardMarketplaces'), tool('flipzi_get_sales', 'getCardSales'),
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
    T('flipzi_search_cards', 'searchCards', 'Search cards by name, set code or number',
      'Finds cards by name (last word prefix-matched), or by the set code and collector number printed on the card (e.g. game "pokemon", set_code "OBF", number "125"), or both. Give at least one of q, set_code or number. Returns card ids needed by every price tool. `printings_count` means other printings of the card exist.', {
      q: z.string().min(2).optional().describe('Card name, e.g. "charizard ex". Optional when set_code or number is given.'),
      game: z.string().optional().describe('Restrict to one game id. Required with set_code.'),
      set_code: z.string().optional().describe('Set code printed on the card, e.g. "OBF" (English Pokemon) or the set id for other games. Needs game.'),
      set_id: z.string().optional().describe('Restrict to one set_id from flipzi_list_sets.'),
      number: z.string().optional().describe('Collector number; "125", "0125" and "125/197" are the same.'),
      lang: z.string().optional().describe('Card language (en, de, fr, it, es, ja, zh): only cards that sold in that language.'),
      page: z.number().int().min(1).optional(), page_size: z.number().int().min(1).max(25).optional().describe('Default 10.'),
    }, (a) => {
      const has = (v: unknown) => typeof v === 'string' && v.trim() !== '';
      if (!has(a.q) && !has(a.set_code) && !has(a.number)) {
        return { path: '', query: {}, error: 'Give q (a name), or set_code and/or number. game and set_id narrow a search but cannot start one; to list a whole set use flipzi_list_set_cards.' };
      }
      if (has(a.set_code) && !has(a.game)) {
        return { path: '', query: {}, error: 'set_code needs game: set codes are only unique within a game (e.g. game "pokemon", set_code "OBF").' };
      }
      return {
        path: '/v1/cards/search',
        query: { q: a.q, game: a.game, set_code: a.set_code, set_id: a.set_id, number: a.number, lang: a.lang, page: a.page, page_size: a.page_size ?? 10 },
        map: (d: any) => (Array.isArray(d?.data) ? { ...d, data: d.data.map(slim) } : d),
      };
    }),
    T('flipzi_lookup_card', 'lookupCard', 'Card id from another catalog',
      'Translates an id from another catalog into the Flipzi card id: a pokemontcg.io id (e.g. "sv3-125", English Pokemon), a Cardmarket idProduct (any game; may return several cards bound to one product) or a TCGplayer product id (the number in tcgplayer.com/product/<id>). Give exactly one. An id Flipzi cannot verify answers CARD_NOT_FOUND.', {
      pokemontcg_id: z.string().optional().describe('pokemontcg.io card id, <set id>-<number>, e.g. "sv3-125".'),
      cardmarket_id: z.number().int().positive().optional().describe('Cardmarket idProduct, e.g. 273752.'),
      tcgplayer_id: z.string().regex(/^[1-9][0-9]{0,9}$/).optional().describe('TCGplayer product id, digits only, e.g. "254761".'),
    }, (a) => {
      const given = (['pokemontcg_id', 'cardmarket_id', 'tcgplayer_id'] as const).filter((k) => a[k] !== undefined && a[k] !== '');
      if (given.length !== 1) return { path: '', query: {}, error: 'Give exactly one of pokemontcg_id, cardmarket_id or tcgplayer_id.' };
      return { path: '/v1/cards/lookup', query: { [given[0]]: a[given[0]] } };
    }),
    withCard('flipzi_get_card', 'getCard', 'Card details', 'Card metadata and variants (no prices).', {},
      (a) => ({ path: cardPath(a), query: {} })),
    withCard('flipzi_get_price', 'getCardPrice', 'Current price', 'Current price for a card, with the market it came from and a confidence rating. Raw (ungraded) by default; graded values need the Pro plan.', {
      currency, grade: z.string().optional().describe('e.g. RAW (default) or PSA_10 (Pro+).'),
    }, (a) => ({ path: cardPath(a, '/price'), query: { currency: a.currency, grade: a.grade } })),
    withCard('flipzi_get_sold_comps', 'getCardSold', 'Sold comparisons', 'What buyers actually paid on eBay for a card: blended sold comps, or for language DE, ES and IT one pool of that language\'s sales on every eBay site (valuation_type pooled_comps). Filter by seller-stated condition and by finish (reverse holo, 1st edition) to compare like with like. For one eBay site use flipzi_get_marketplace_comps; for the individual sales, flipzi_get_sales.', {
      currency, grade: GRADE, language: soldLanguage('Default: the card\'s own language.'), finish, condition,
    }, (a) => ({ path: cardPath(a, '/sold'), query: { currency: a.currency, grade: a.grade, language: upper(a.language), finish: a.finish, condition: a.condition } })),
    withCard('flipzi_get_marketplace_comps', 'getCardMarketplaces', 'Sold comps per eBay site',
      'The flipzi_get_sold_comps blend broken apart per eBay site (ebay_uk, ebay_us, ebay_au, ebay_ca, ebay_de, ebay_fr, ebay_it, ebay_es): each site\'s median, sample size, 30-day range and last sale, with `native` in the currency that site quoted next to the converted price. A site missing from the answer had no qualifying sales. Every listing language is returned unless you pass language; ebay_de/fr/it/es have no EN rows.', {
      currency, grade: GRADE, language: soldLanguage('Default: every language.'), marketplace, finish, condition,
    }, (a) => ({ path: cardPath(a, '/marketplaces'), query: { currency: a.currency, grade: a.grade, language: upper(a.language), marketplace: a.marketplace, finish: a.finish, condition: a.condition } })),
    withCard('flipzi_get_sales', 'getCardSales', 'Individual eBay sales',
      'The completed eBay sales behind the sold comps, one row per sale, newest first: date, site, price as paid (`native`) and converted, grade, seller-stated condition, title, best_offer_accepted (then the buyer may have paid less than shown). Use it to judge a thin sample. Only sellers based in the site\'s own country are listed.', {
      currency, grade: GRADE, language: soldLanguage('Default: every language.'), marketplace,
      period: z.enum(['7d', '30d', '90d', '6m', '1y', 'all']).optional().describe('How far back, within your plan\'s history depth. Default 90d.'),
      finish, condition,
      page: z.number().int().min(1).optional(), page_size: z.number().int().min(1).max(50).optional().describe('Default 20.'),
    }, (a) => ({ path: cardPath(a, '/sales'), query: { currency: a.currency, grade: a.grade, language: upper(a.language), marketplace: a.marketplace, period: a.period, finish: a.finish, condition: a.condition, page: a.page, page_size: a.page_size ?? 20 } })),
    withCard('flipzi_get_cardmarket_conditions', 'getCardCardmarketConditions', 'Cardmarket prices by condition',
      'What Cardmarket sellers ask for a card per language, finish and Cardmarket grade (MT Mint, NM, EX Excellent, GD Good, LP Light Played, PL Played, PO Poor): the cheapest visible offer and the median of the visible offers, in EUR, with the date the page was read. `coverage` says whether there is data: covered, no_offers, stale (older than 60 days, no figure) or not_covered (Pokemon EN/JP and One Piece singles from EUR 2 are covered, and German, Spanish and Italian copies of English Pokemon cards from EUR 5 Near Mint). `daily_lowest_near_mint` adds the cheapest Near Mint copy in German, Spanish and Italian from Cardmarket\'s daily figures. Cardmarket grades are not eBay conditions; `us_grade` is only a rough hint. Asking prices, not sales: use flipzi_get_sold_comps for what sold.', {
      language: z.enum(['en', 'ja', 'de', 'es', 'it']).optional().describe('Only this Cardmarket language. Default: every language the card has.'),
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
    T('flipzi_search_sealed', 'searchSealed', 'Search sealed products',
      'Searches 7,600+ sealed products (booster boxes, Elite Trainer Boxes, booster bundles, tins, blisters, decks, collections, cases, accessories) for Pokemon, Japanese Pokemon, One Piece, Lorcana and Riftbound. Each row has its `type`, its daily prices (`cardmarket` = lowest listed price on Cardmarket, `tcgplayer` = TCGplayer market price; a price older than 7 days is left out) and `cardmarket_offers` (true when flipzi_get_sealed_cardmarket has offer figures). Asking prices, not sales: sealed products have no eBay sold prices here.', {
      q: z.string().optional().describe('Words in the product name, each prefix-matched, e.g. "destined rivals".'),
      game: z.string().optional().describe('Game id, e.g. "pokemon", "pokemon-jp", "onepiece", "lorcana", "riftbound".'),
      type: z.enum(SEALED_TYPES).optional().describe('Product type, e.g. elite_trainer_box or booster_box.'),
      set_id: z.string().optional().describe('Sealed set slug, e.g. "destined-rivals".'),
      priced: z.boolean().optional().describe('true: only products with a current price.'),
      currency, page: z.number().int().min(1).optional(), page_size: z.number().int().min(1).max(50).optional().describe('Default 20.'),
    }, (a) => ({
      path: '/v1/sealed',
      query: { q: a.q, game: a.game, type: a.type, set_id: a.set_id, priced: a.priced === undefined ? undefined : String(a.priced), currency: a.currency, page: a.page, page_size: a.page_size ?? 20 },
      map: (d: any) => (Array.isArray(d?.data) ? { ...d, data: d.data.map(slimSealed) } : d),
    })),
    T('flipzi_get_sealed_cardmarket', 'getSealedCardmarket', 'Cardmarket offers for a sealed product',
      'What Cardmarket sellers ask for a sealed product, per language and edition (standard, first_edition): the cheapest and median visible offer, offers and copies, in EUR. `coverage` is covered, no_offers, stale or not_covered (English Pokemon sealed from EUR 10 is covered; flipzi_search_sealed marks those rows cardmarket_offers: true).', {
      sealed_id: z.string().describe('Sealed product id (UUID) from flipzi_search_sealed.'),
      seller_country: z.string().optional().describe('Only offers from sellers in these countries: ISO codes, comma-separated, or "eu". Default: anywhere.'),
    }, (a) => ({ path: `/v1/sealed/${encodeURIComponent(a.sealed_id)}/cardmarket`, query: { seller_country: a.seller_country } })),
    T('flipzi_get_box_value', 'getSealedComparisons', 'Booster box value', 'Sealed booster-box price vs the ESTIMATED value of the cards inside (English Pokemon boxes that pass Flipzi checks). Values are a low/base/high range at CardMarket EUR prices; pull rates are estimates, so this is not a promise about any one box. Omit `set` to list every published box; pass a box `set` slug (from the list) for its top cards and history.', {
      set: z.string().optional().describe('Box slug from the list, e.g. "paldea-evolved". Omit to list all published boxes.'),
      history_days: z.number().int().min(1).max(365).optional().describe('With `set`: days of history. Default 90.'),
    }, (a) => a.set
      ? { path: `/v1/sealed/comparisons/${encodeURIComponent(a.set)}`, query: { history_days: a.history_days } }
      : { path: '/v1/sealed/comparisons', query: { game: 'pokemon' } }),
    {
      name: 'flipzi_get_prices_bulk', op: 'bulkCardPrices', title: 'Current prices for many cards',
      description: `Current prices for many cards in one call (ids per call: Basic 25, Pro 100, Ultra 500, Mega 750), same figures as flipzi_get_price. Ids may be Flipzi UUIDs or pokemontcg.io ids ("sv3-125"); unknown ids come back in not_found. ${planText('bulkCardPrices')} Cost: 1 unit per distinct id, counted against this session's unit budget before the request is sent: a batch bigger than what is left of it (FLIPZI_MCP_MAX_UNITS, default 150) is refused without a request.`,
      shape: {
        card_ids: z.array(z.string()).min(1).max(1000).describe('Card ids (UUIDs from flipzi_search_cards, or pokemontcg.io ids). Duplicates are sent and charged once.'),
        currency, grade: GRADE,
      },
      async run(a: any) {
        const ids = distinctIds(Array.isArray(a.card_ids) ? a.card_ids : []);
        if (!ids.length) return { isError: true, text: 'card_ids is empty. Get ids from flipzi_search_cards or flipzi_list_set_cards.' };
        const body: Record<string, unknown> = { card_ids: ids };
        if (a.currency) body.currency = a.currency;
        if (a.grade) body.grade = a.grade;
        return call('flipzi_get_prices_bulk', 'bulkCardPrices', '/v1/cards/bulk', {}, (d) => d, { body, units: ids.length });
      },
    },
  ];
  return tools;
}
