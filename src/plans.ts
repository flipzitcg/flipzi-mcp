import { OPS, PlanReq } from './plans.generated.js';

export const RANK = ['sandbox', 'basic', 'pro', 'ultra', 'mega'];
export const rank = (p: string): number => {
  const i = RANK.indexOf(p === 'free' ? 'sandbox' : p);
  return i; // -1 = unknown/legacy/business: do not guess
};
export const req = (op: string): PlanReq => OPS[op];
export const unitsOf = (op: string): number => { const u = OPS[op]?.units; return typeof u === 'number' ? u : 1; };

export function unitsText(op: string): string {
  const u = OPS[op]?.units;
  return typeof u === 'number' ? `${u} unit${u === 1 ? '' : 's'}` : String(u);
}
export function planText(op: string): string {
  const m = OPS[op]?.min_plan;
  return !m || m === 'sandbox' || m === 'any' || m === 'none' ? 'Available on the free plan.' : `Requires the ${m} plan or higher.`;
}
/** true/false when the plan is on the standard ladder; null when it is not (legacy, business...). */
export function unlocked(op: string, plan: string): boolean | null {
  const m = OPS[op]?.min_plan;
  if (!m || m === 'sandbox' || m === 'any' || m === 'none') return true;
  const have = rank(plan);
  if (have < 0) return plan === 'business' ? true : null;
  return have >= rank(m);
}
