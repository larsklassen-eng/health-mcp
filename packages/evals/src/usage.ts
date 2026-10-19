import type { ChatUsage } from "@health-mcp/shared";

/** The usage of several answers added up. Cached tokens and cost count only where reported. */
export function sumUsage(usages: (ChatUsage | undefined)[]): ChatUsage {
  const total: ChatUsage = { modelCalls: 0, inputTokens: 0, outputTokens: 0 };
  for (const usage of usages) {
    if (!usage) continue;
    total.modelCalls += usage.modelCalls;
    total.inputTokens += usage.inputTokens;
    total.outputTokens += usage.outputTokens;
    if (usage.cachedInputTokens !== undefined)
      total.cachedInputTokens = (total.cachedInputTokens ?? 0) + usage.cachedInputTokens;
    if (usage.costUsd !== undefined) total.costUsd = (total.costUsd ?? 0) + usage.costUsd;
  }
  return total;
}

const tokens = new Intl.NumberFormat("en-US");

/** "3 model calls, 12,345 in (8,000 cached) / 678 out, $0.0421". */
export function formatUsage(usage: ChatUsage | undefined): string {
  if (!usage) return "usage not reported";
  const cached =
    usage.cachedInputTokens === undefined
      ? ""
      : ` (${tokens.format(usage.cachedInputTokens)} cached)`;
  const cost = usage.costUsd === undefined ? "cost not reported" : `$${usage.costUsd.toFixed(4)}`;
  const calls = `${usage.modelCalls} model call${usage.modelCalls === 1 ? "" : "s"}`;
  return (
    `${calls}, ${tokens.format(usage.inputTokens)} in${cached} / ` +
    `${tokens.format(usage.outputTokens)} out, ${cost}`
  );
}
