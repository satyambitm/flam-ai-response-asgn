import type { Usage } from "./api";

/** "432 in · 248 out tokens · $0.000214" — cost shown to 3 significant figures, "n/a" when unknown. */
export function formatUsage(usage: Usage | null): string {
  if (!usage) return "usage n/a";
  const tokens = `${usage.inputTokens.toLocaleString()} in · ${usage.outputTokens.toLocaleString()} out tokens`;
  return `${tokens} · ${formatCost(usage.costUsd)}`;
}

export function formatCost(usd: number | null): string {
  if (usd === null) return "cost n/a";
  if (usd === 0) return "$0";
  return `$${usd < 0.01 ? usd.toPrecision(3) : usd.toFixed(4)}`;
}
