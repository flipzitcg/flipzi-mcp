# Flipzi MCP server

Ask Claude, Cursor or any MCP client about trading card prices: search cards, get current prices, sold comps, price history, market movers, games and sets. It is a thin local wrapper over the [Flipzi Data API](https://flipzi.io/api/?utm_source=npm&utm_medium=directory&utm_campaign=202610_mcp). **You bring your own Flipzi API key; the free plan needs no card.**

Runs on your machine over stdio (`npx`). Nothing is hosted, and the only network traffic is your requests to `data.flipzi.io`.

## 1. Get a key (free)

1. Create an account: <https://flipzi.io/account/register?product=data&utm_source=npm&utm_medium=directory&utm_campaign=202610_mcp>
2. Verify your email. A free key allowance (500 units/month, 5 requests/minute) is created for you.
3. Create a key at <https://flipzi.io/account/keys> (it starts with `fz_live_` and is shown once).

## 2. Add it to your AI tool

Requires Node.js 18+. Replace `fz_live_...` with your key.

**Claude Code**
```bash
claude mcp add --env FLIPZI_API_KEY=fz_live_... --transport stdio flipzi -- npx -y @flipzitcg/mcp
```
Check with `claude mcp list` or `/mcp`. Add `--scope user` to use it in every project.

**Claude Desktop (one click)** — once the release publishes it, download `flipzi-mcp.mcpb` from the GitLab release and open it; Claude Desktop asks for your key in a masked field.

**Claude Desktop (config file)** — Settings → Developer → Edit Config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows), then fully quit and reopen the app:
```json
{
  "mcpServers": {
    "flipzi": {
      "command": "npx",
      "args": ["-y", "@flipzitcg/mcp"],
      "env": { "FLIPZI_API_KEY": "fz_live_..." }
    }
  }
}
```

**Cursor** — add the same block to `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project). Do not commit a file containing your key.

Then ask: *"What's an Umbreon VMAX worth right now?"* or call `flipzi_account` to see your plan.

## Tools

| Tool | Needs | Units | What it does |
|---|---|---|---|
| `flipzi_account` | any key | 0 | Your plan, allowance used, which tools your plan unlocks |
| `flipzi_list_games` | Free | 1 | Supported games |
| `flipzi_list_sets` | Free | 1 | Sets of a game |
| `flipzi_list_set_cards` | Free | 1 | Cards in a set (gets card ids) |
| `flipzi_search_cards` | Free | 1 | Search by name |
| `flipzi_get_card` | Free | 1 | Card details |
| `flipzi_get_price` | Free | 1 | Current price, market and confidence (graded needs Pro) |
| `flipzi_get_history` | Basic | 1 | Daily history (30 days on Basic, longer on Pro+) |
| `flipzi_get_sold_comps` | Pro | 1 | What buyers actually paid on eBay |
| `flipzi_get_movers` | Ultra | 5 | Biggest gainers/losers for a game |

Requirements are read from the API's own contract (`openapi.yaml`, version in `src/plans.generated.ts`), not guessed. Plans and prices: <https://flipzi.io/api/pricing/?utm_source=npm&utm_medium=directory&utm_campaign=202610_mcp>. **Every tool is always listed.** When your plan does not include one, the tool says so, names the plan that does, links the upgrade, and the refusal costs 0 units.

## Allowance and limits

- One unit per call (movers 5). The API counts per account per UTC month; `flipzi_account` shows what is left.
- The free plan allows **5 requests per minute**. A short wait (≤10 s) is retried once automatically; longer waits are reported.
- **Session budget:** this server stops itself after `FLIPZI_MCP_MAX_UNITS` units per run (default 150) so an agent loop cannot burn your month. Set `0` for unlimited. Restart the server to reset it.
- Output is capped at about 20 KB per call; search returns 10 cards by default.

## Settings (environment variables)

| Variable | Default | |
|---|---|---|
| `FLIPZI_API_KEY` | required | Your key. Never printed or logged. |
| `FLIPZI_MCP_MAX_UNITS` | `150` | Per-run unit budget, `0` = unlimited |
| `FLIPZI_MCP_NO_CLIENT_TAG` | unset | `1` stops sending the client header below |
| `FLIPZI_API_BASE` | `https://data.flipzi.io` | For testing only |

## What is sent, and what Flipzi learns (no hidden telemetry)

- Your requests go to `data.flipzi.io` with your key, exactly as any API client would. **There is no other network call**, no analytics service, no update check, and no remote control.
- Each request carries `User-Agent: flipzi-mcp/<version>` and `X-Flipzi-Client: mcp/<version>`. Flipzi records only that the call came from the MCP server (the value `mcp`), so it can count MCP usage and see which plan-locked tools people try. Opt out with `FLIPZI_MCP_NO_CLIENT_TAG=1`; everything works the same.
- Links this server prints (signup, keys, upgrade) include `utm_source=mcp` so Flipzi can tell that an account started from here. They are plain query parameters you can delete.
- Prompts, conversations and card queries are not sent anywhere except as the API parameters of the call you asked for.

## Troubleshooting

- *"FLIPZI_API_KEY is not set"* — the key is missing from the `env` of your client config; restart the client after editing.
- *Tools don't appear in Claude Desktop* — fully quit and reopen; check `~/Library/Logs/Claude/mcp-server-flipzi.log` (macOS) or `%APPDATA%\Claude\logs` (Windows). On Windows, if `npx` fails, install npm globally (`npm install -g npm`).
- *"Not on your plan"* — expected; see the table. Run `flipzi_account`.
- Quote the `request_id` in any error when contacting support. See [SUPPORT.md](SUPPORT.md).

The free plan carries no commercial-use grant. Data is for informational use; see the [API terms](https://flipzi.io/api/terms/). MIT licensed.
