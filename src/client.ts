import { Budget } from './budget.js';

export const VERSION = '0.1.1';

export interface ApiError {
  status: number;
  code: string;
  message: string;
  details: Record<string, any>;
  requestId?: string;
  retryAfter?: number;
}
export interface Meta { quotaRemaining?: number; quotaLimit?: number; requestId?: string; cache?: string }
export type Result = { ok: true; data: any; meta: Meta } | { ok: false; error: ApiError };

export interface ClientOptions {
  apiKey?: string;
  baseUrl?: string;
  budget: Budget;
  tagClient?: boolean;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

const MAX_AUTO_WAIT_S = 10;

export class FlipziClient {
  private base: string;
  private f: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  constructor(private o: ClientOptions) {
    this.base = (o.baseUrl || 'https://data.flipzi.io').replace(/\/+$/, '');
    this.f = o.fetchImpl ?? fetch;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }
  get hasKey(): boolean { return !!this.o.apiKey; }
  get budget(): Budget { return this.o.budget; }

  /** cost = units this call is expected to bill; refusals bill 0 and are not counted. */
  async get(path: string, query: Record<string, string | number | undefined>, cost: number): Promise<Result> {
    if (!this.o.budget.allows(cost)) {
      return {
        ok: false,
        error: {
          status: 0, code: 'MCP_SESSION_BUDGET',
          message: `This MCP session has used ${this.o.budget.used} of its ${this.o.budget.max}-unit safety budget (FLIPZI_MCP_MAX_UNITS). ` +
            'No request was sent. Raise FLIPZI_MCP_MAX_UNITS (0 = unlimited) and restart the server to continue.',
          details: {},
        },
      };
    }
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') qs.set(k, String(v));
    const url = this.base + path + (qs.toString() ? '?' + qs : '');
    for (let attempt = 0; ; attempt++) {
      const r = await this.once(url);
      if (!r.ok && r.error.code === 'RATE_LIMITED' && attempt === 0 && (r.error.retryAfter ?? 99) <= MAX_AUTO_WAIT_S) {
        await this.sleep(Math.max(1, r.error.retryAfter ?? 1) * 1000);
        continue;
      }
      if (r.ok) this.o.budget.add(cost);
      return r;
    }
  }

  private async once(url: string): Promise<Result> {
    const headers: Record<string, string> = {
      'X-API-Key': this.o.apiKey ?? '',
      Accept: 'application/json',
      'User-Agent': `flipzi-mcp/${VERSION}`,
    };
    if (this.o.tagClient !== false) headers['X-Flipzi-Client'] = `mcp/${VERSION}`;
    let res: Response;
    try {
      res = await this.f(url, { headers, signal: AbortSignal.timeout(this.o.timeoutMs ?? 20000) });
    } catch (e: any) {
      return { ok: false, error: { status: 0, code: 'NETWORK_ERROR', message: `Could not reach the Flipzi API: ${e?.name === 'TimeoutError' ? 'timed out' : e?.message ?? e}`, details: {} } };
    }
    const text = await res.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    const num = (h: string) => { const v = res.headers.get(h); return v === null ? undefined : Number(v); };
    if (res.ok) {
      return {
        ok: true, data: body,
        meta: { quotaRemaining: num('x-quota-remaining'), quotaLimit: num('x-quota-limit'), requestId: res.headers.get('x-request-id') ?? undefined, cache: res.headers.get('x-cache') ?? undefined },
      };
    }
    const e = body?.error ?? {};
    return {
      ok: false,
      error: {
        status: res.status,
        code: e.code ?? `HTTP_${res.status}`,
        message: e.message ?? (text.slice(0, 200) || res.statusText),
        details: e.details ?? {},
        requestId: e.request_id ?? res.headers.get('x-request-id') ?? undefined,
        retryAfter: num('retry-after'),
      },
    };
  }
}
