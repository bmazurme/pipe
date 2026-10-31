// Remembers the results of an expensive async build by key and shares one in-flight build
// between concurrent callers. Only resolved values are stored: a failed build is retried on the
// next call, unless staleOnErrorMs is set: then a failed build resolves with the last good value
// if it is at most that old (clear() only expires values, it keeps this fallback). Beyond maxEntries the oldest stored value is evicted.
export class SharedAsyncCache<V> {
  private readonly ttlMs?: number;
  private readonly maxEntries: number;
  // Oldest first.
  private readonly values = new Map<string, { value: V; at: number }>();
  // Last successful value per key, kept past expiry and clear() for the stale-on-error fallback.
  private readonly lastGood = new Map<string, { value: V; at: number }>();
  private readonly pending = new Map<
    string,
    Promise<{ value: V; staleSince?: number }>
  >();
  private readonly staleOnErrorMs?: number;
  private readonly onStale?: (
    key: string,
    since: number,
    error: unknown,
  ) => void;
  // Bumped by clear(): a build started before it must not store its (possibly stale) value.
  private epoch = 0;

  constructor({
    ttlMs,
    maxEntries,
    staleOnErrorMs,
    onStale,
  }: {
    ttlMs?: number;
    maxEntries: number;
    staleOnErrorMs?: number;
    // Called once per failed build that was answered with a stale value.
    onStale?: (key: string, since: number, error: unknown) => void;
  }) {
    this.ttlMs = ttlMs;
    this.staleOnErrorMs = staleOnErrorMs;
    this.onStale = onStale;
    this.maxEntries = maxEntries;
  }

  get(key: string, build: () => Promise<V>): Promise<V> {
    return this.getWithMeta(key, build).then((r) => r.value);
  }

  // Like get(), also reporting when a stale fallback value dates from (staleSince).
  getWithMeta(
    key: string,
    build: () => Promise<V>,
  ): Promise<{ value: V; staleSince?: number }> {
    const cached = this.values.get(key);

    if (
      cached &&
      (this.ttlMs === undefined || Date.now() - cached.at < this.ttlMs)
    )
      return Promise.resolve({ value: cached.value });

    const pending = this.pending.get(key);

    if (pending) return pending;

    // Started on a microtask, so even a build that throws synchronously ends up as a rejection.
    const epoch = this.epoch;
    const promise = Promise.resolve()
      .then(build)
      .then(
        (value) => {
          const at = Date.now();

          if (epoch !== this.epoch) return { value };

          this.values.delete(key);
          this.values.set(key, { value, at });
          this.lastGood.delete(key);
          this.lastGood.set(key, { value, at });
          while (this.values.size > this.maxEntries)
            this.values.delete(this.values.keys().next().value!);
          while (this.lastGood.size > this.maxEntries)
            this.lastGood.delete(this.lastGood.keys().next().value!);

          return { value };
        },
        (error: unknown) => {
          const good = this.lastGood.get(key);

          if (
            this.staleOnErrorMs === undefined ||
            !good ||
            Date.now() - good.at > this.staleOnErrorMs
          )
            throw error;

          this.onStale?.(key, good.at, error);

          return { value: good.value, staleSince: good.at };
        },
      );
    const clear = (): void => {
      if (this.pending.get(key) === promise) this.pending.delete(key);
    };

    this.pending.set(key, promise);
    promise.then(clear, clear);

    return promise;
  }

  // Forgets every stored value and detaches in-flight builds, so the next get() builds anew.
  clear(): void {
    this.epoch += 1;
    this.values.clear();
    this.pending.clear();
  }
}
