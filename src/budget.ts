// Per-process unit budget. An agent in a loop can burn a 500-unit free allowance in minutes;
// this refuses locally (0 units, no request) once the session has spent its share.
export class Budget {
  private spent = 0;
  constructor(readonly max: number) {}
  get used(): number { return this.spent; }
  get remaining(): number { return Math.max(0, this.max - this.spent); }
  allows(cost: number): boolean { return this.max <= 0 || this.spent + cost <= this.max; }
  add(units: number): void { this.spent += units; }
}

export function budgetFromEnv(env: NodeJS.ProcessEnv): Budget {
  const raw = env.FLIPZI_MCP_MAX_UNITS;
  const n = raw === undefined || raw === '' ? 150 : Number(raw);
  return new Budget(Number.isFinite(n) && n >= 0 ? Math.floor(n) : 150);
}
