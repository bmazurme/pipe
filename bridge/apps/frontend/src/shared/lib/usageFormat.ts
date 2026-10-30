// How the Расходы page words durations, token counts and costs.

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} с`;

  const minutes = Math.round(seconds / 60);

  if (minutes < 60) return `${minutes} мин`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)} млн`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)} тыс`;

  return String(tokens);
}

export function formatCost(usd: number): string {
  return `$${usd < 0.01 && usd > 0 ? usd.toFixed(4) : usd.toFixed(2)}`;
}
