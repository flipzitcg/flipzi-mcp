# Releasing flipzi-mcp (B6)

Build sessions never publish. This is the separate release step. Nothing here has been run.

## Decisions Vasil makes first
1. **npm name** — `flipzi-mcp` was unclaimed on 2026-10-08. Prefer a scope (`@flipzi/mcp`) if the npm org exists; if you rename, change `package.json` name, `server.json` identifier, every `npx -y flipzi-mcp` in README/website/docs.
2. **Public GitHub repo** (needed by registries and for issues). Default `flipzi/flipzi-mcp`; fix `server.json` `repository.url` and add `repository`/`bugs` to `package.json`. `git remote add origin … && git push -u origin main`. Note `sync-git-repos.sh` pushes any repo that has an upstream.
3. **Registry namespace** — `mcpName` in `package.json` must equal `server.json` `name`. Current value `io.flipzi/flipzi-mcp` needs DNS verification of flipzi.io (TXT record, `mcp-publisher login dns`); the zero-DNS alternative is `io.github.<github-user-or-org>/flipzi-mcp` with `mcp-publisher login github`.
4. **Client tag** — keep (activation measurement) or drop (remove the header in `src/client.ts`; the README already documents the opt-out).

## Order
1. **Server side (api-data / backend).** The B6 code is already on disk and committed; it is inert until:
   a. Check first: `information_schema.columns` for `data_api_usage.client` (use the read-only PHP bootstrap; migrations are applied by hand).
   b. `cd /home/flipzi/backend && php database/run-migrations.php database/migrations/181_data_api_usage_client.sql`
   c. Add `DATA_API_CLIENT_TAG_ENABLED=true` to `api-data/.env` (quote values; see backend `.env` parse note). The `www` fpm pool picks it up in ~2 s (opcache revalidate).
   d. `php api-data/tests/test-client-tag.php && php api-data/tests/test-openapi-contract.php`
2. **Package checks** (any machine with Node 18+): `cd mcp-server && npm ci && npm test && npm run check:plans && npm pack --dry-run` (expect only `dist/src`, docs, `server.json`).
3. **Live smoke with a real key**: `FLIPZI_API_KEY=fz_live_… npm run smoke`.
   - sandbox key: account/games/search/card/price OK, history + sold comps refused with an upgrade link.
   - Pro or Ultra key: sold comps (and with `SMOKE_MOVERS=1`, movers on Ultra) return data.
   - then in the real clients: `claude mcp add …` (README), Claude Desktop, Cursor — ask one price question each.
4. **Publish**: `npm publish --access public --provenance` (provenance needs CI; otherwise drop the flag). Then `npx -y flipzi-mcp@latest` from a clean dir.
4b. **Bundle**: `npm run build:mcpb` → `dist-mcpb/flipzi-mcp.mcpb` (145 KB, single bundled file). Install it in Claude Desktop once by hand before attaching it to the GitHub release; fix the README sentence if the install flow differs. Smithery takes local servers only as a `.mcpb` (`smithery mcp publish ./flipzi-mcp.mcpb -n <org>/flipzi`).
5. **Registry** (see `website/docs/B6-DIRECTORIES.md`): `mcp-publisher login …`, `mcp-publisher publish`.
6. **Website**: apply `website/docs/b6-release/` (page + product.json/api-switch claim "no MCP server" + llms.txt). Only after step 4, the page tells people to `npx` a package.
7. **Reports (as root)**: `php generate_api_analytics.php`; check the `mcp` and `acquisition` blocks in `agent-files/analytics-output/api_*latest.json`.

## Operating controls / pause
| Need | Action |
|---|---|
| Stop recording MCP usage | `DATA_API_CLIENT_TAG_ENABLED=false` in `api-data/.env` (nothing else depends on it) |
| Warn users off a bad version | `npm deprecate flipzi-mcp@"<=0.1.0" "message"` |
| Pull the package | `npm unpublish` (only within npm's window) or deprecate; delist from the registry (`mcp-publisher` status update) |
| A leaked/abused key | Revoke at flipzi.io/account/keys; the server has no key store |
| Stop a runaway agent | Already bounded by `FLIPZI_MCP_MAX_UNITS` per run; account-level quota and 5/min limit still apply |
There is deliberately no remote kill switch: it would be undisclosed network traffic.

## Rollback
Flag off → deprecate/unpublish → delist → revert the website patch. Migration 181 is additive and can stay.

## Maintenance (ongoing)
- When `api-data/openapi.yaml` changes (routes, `x-flipzi-plan`, plan matrix): `npm run gen:plans`, run tests, bump version, `npm publish`. `npm test` fails if the generated file is stale (when run next to `api-data`).
- Add tools only for endpoints in the spec; update README table (a test checks every tool is documented).
- Dependabot-style updates for `@modelcontextprotocol/sdk` and Node LTS, a few times a year. Node 18 is already EOL upstream; raise `engines` when the SDK does.
- Triage issues per SUPPORT.md. Expect support questions to be about config files and plan limits, not data.
- Registry entries record a version: re-run `mcp-publisher publish` with each npm release.
