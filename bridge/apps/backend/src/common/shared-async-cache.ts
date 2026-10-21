// Remembers the results of an expensive async build by key and shares one in-flight build
// between concurrent callers. Only resolved values are stored: a failed build is retried on the
// next call. Beyond maxEntries the oldest stored value is evicted.
export class SharedAsyncCache<V> {
  private readonly ttlMs?: number;
  private readonly maxEntries: number;
  // Oldest first.
  private readonly values = new Map<string, { value: V; at: number }>();
  private readonly pending = new Map<string, Promise<V>>();

  constructor({ ttlMs, maxEntries }: { ttlMs?: number; maxEntries: number }) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  get(key: string, build: () => Promise<V>): Promise<V> {
    const cached = this.values.get(key);

    if (
      cached &&
      (this.ttlMs === undefined || Date.now() - cached.at < this.ttlMs)
    )
      return Promise.resolve(cached.value);

    const pending = this.pending.get(key);

    if (pending) return pending;

    // Started on a microtask, so even a build that throws synchronously ends up as a rejection.
    const promise = Promise.resolve()
      .then(build)
      .then((value) => {
        this.values.delete(key);
        this.values.set(key, { value, at: Date.now() });
        while (this.values.size > this.maxEntries)
          this.values.delete(this.values.keys().next().value!);

        return value;
      });
    const clear = (): void => {
      if (this.pending.get(key) === promise) this.pending.delete(key);
    };

    this.pending.set(key, promise);
    promise.then(clear, clear);

    return promise;
  }
}
