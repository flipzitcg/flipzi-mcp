# Changelog

## 0.3.0
- **Search by the codes printed on a card.** `flipzi_search_cards` no longer requires `q`: give `set_code` (with `game`) and/or `number`, as the Data API allows. It refuses locally, at 0 units, when none of `q`, `set_code` or `number` is given, or `set_code` comes without `game`. Search rows now keep `printings_count`, `base_card_id` and `finishes`, so an agent can see that other printings exist.
- **`flipzi_get_sold_comps`**: `condition` (`nm`, `lp`, `mp`, `hp`, `dmg`; seller-stated, Pro and above) and `finish` (`standard`, `reverse_holo`, `first_edition`). `language` is documented with its values and sent upper-case.
- **`flipzi_get_marketplace_comps`** (Ultra, 1 unit): sold comps per eBay site, in the site's own currency (`/v1/cards/{id}/marketplaces`).
- **`flipzi_get_sales`** (Ultra, 1 unit): the individual eBay sales behind the comps (`/v1/cards/{id}/sales`), 20 per page by default.
- **`flipzi_get_prices_bulk`** (Basic and above, 1 unit per distinct id): current prices for many cards in one call (`POST /v1/cards/bulk`). Duplicate ids are sent and charged once, and the per-run budget (`FLIPZI_MCP_MAX_UNITS`) counts every id before the request is sent.
- **`flipzi_lookup_card`** (free, 1 unit): Flipzi card id from a pokemontcg.io id, a Cardmarket idProduct or a TCGplayer product id (`/v1/cards/lookup`).
- Plan requirements regenerated from Data API `openapi.yaml` 1.26.0.
- The repository no longer carries the `mcp-publisher` binary.

## 0.2.1
- `flipzi_search_sealed` is on Pro and above, as the Data API now gates `/v1/sealed` (`sealed_catalog`). 0.2.0 described it as free; on a lower plan it answers with the upgrade link and costs 0 units.

## 0.2.0
- **Sealed products.** `flipzi_search_sealed` (1 unit): search more than 7,600 sealed products, booster boxes, Elite Trainer Boxes, booster bundles, tins, blisters, decks, collections, cases and accessories, for Pokémon, Japanese Pokémon, One Piece, Lorcana and Riftbound, by name, game, type and set, with each product's daily Cardmarket and TCGplayer price (Data API 1.24.0).
- `flipzi_get_sealed_cardmarket` (Ultra and above): Cardmarket asking prices for a sealed product per language and edition.
- `flipzi_get_cardmarket_conditions`: Cardmarket asking prices by language, finish and Cardmarket grade (Data API 1.16.0, Ultra and above).
- `flipzi_get_cardmarket_conditions`: languages `de`, `es`, `it` and `daily_lowest_near_mint` (Data API 1.23.0); `flipzi_get_sold_comps` describes the pooled DE/ES/IT prices.
- Plan requirements regenerated from Data API `openapi.yaml` 1.24.0.
- The Claude Desktop bundle (`.mcpb`) lists every tool.

## 0.1.1
- Repository moved to GitHub: <https://github.com/flipzitcg/flipzi-mcp>.
- `flipzi_get_box_value`: sealed booster-box price vs the estimated value of the contents (Data API 1.12.0, Pro and above).

## 0.1.0
- First release: 10 read-only tools (account, games, sets, set cards, search, card, price, history, sold comps, movers).
- Plan requirements generated from Data API `openapi.yaml` 1.11.0.
- Session unit budget, rate-limit retry, UTM-tagged upgrade links, disclosed `X-Flipzi-Client` header (opt-out).
