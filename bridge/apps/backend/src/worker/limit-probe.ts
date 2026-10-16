// A worker probes the Claude plan limits (one tiny call) when the owner asked for it, or every `limitsRefreshMin` minutes. Whether a probe is
// DUE is decided here, from what the worker's settings say; the token travels to the worker only then.
export const REQUEST_VALID_MS = 10 * 60 * 1000;

export function limitProbeWanted(
  settings: { limitsRefreshMin: number; limitsRefreshRequestedAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (settings.limitsRefreshMin > 0) return true;

  return (
    settings.limitsRefreshRequestedAt !== null &&
    now.getTime() - settings.limitsRefreshRequestedAt.getTime() <
      REQUEST_VALID_MS
  );
}
