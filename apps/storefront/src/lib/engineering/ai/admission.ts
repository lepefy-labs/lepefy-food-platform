/** Pure admission rule of an Engineering AI question: off switch, rate limit, daily budget. */
export type Admission = 'ok' | 'disabled' | 'rate_limited' | 'budget_exceeded';

export function decideAdmission(input: { aiEnabled: boolean; recentCount: number; perMinuteLimit: number; spentTodayUsd: number; dailyBudgetUsd: number }): Admission {
  if (!input.aiEnabled) return 'disabled';
  if (input.recentCount >= input.perMinuteLimit) return 'rate_limited';
  // A zero budget means "no spending allowed", not "unlimited".
  if (input.spentTodayUsd >= input.dailyBudgetUsd) return 'budget_exceeded';
  return 'ok';
}

/** Tokens x tariff (USD per million). Unknown tariff = 0 and the caller reports it as unpriced. */
export function estimateCostUsd(inputTokens: number | undefined, outputTokens: number | undefined, inputPerMillion: number | null, outputPerMillion: number | null): number {
  const input = inputTokens && inputPerMillion ? (inputTokens / 1_000_000) * inputPerMillion : 0;
  const output = outputTokens && outputPerMillion ? (outputTokens / 1_000_000) * outputPerMillion : 0;
  return Math.round((input + output) * 1_000_000) / 1_000_000;
}

export function startOfUtcDay(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}
