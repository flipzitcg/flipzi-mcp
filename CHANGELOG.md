# Changelog

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
