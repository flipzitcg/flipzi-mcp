# Changelog

## Unreleased
- `flipzi_get_cardmarket_conditions`: Cardmarket asking prices by language, finish and Cardmarket grade (Data API 1.16.0, Ultra and above).
- `flipzi_get_cardmarket_conditions`: languages `de`, `es`, `it` and `daily_lowest_near_mint` (Data API 1.23.0); `flipzi_get_sold_comps` describes the pooled DE/ES/IT prices.
- Plan requirements regenerated from Data API `openapi.yaml` 1.23.0.

## 0.1.1
- Repository moved to GitHub: <https://github.com/flipzitcg/flipzi-mcp>.
- `flipzi_get_box_value`: sealed booster-box price vs the estimated value of the contents (Data API 1.12.0, Pro and above).

## 0.1.0
- First release: 10 read-only tools (account, games, sets, set cards, search, card, price, history, sold comps, movers).
- Plan requirements generated from Data API `openapi.yaml` 1.11.0.
- Session unit budget, rate-limit retry, UTM-tagged upgrade links, disclosed `X-Flipzi-Client` header (opt-out).
