/**
 * Share one in-flight Promise per key so concurrent callers reuse the same work.
 * Work is deferred so the promise is stored in the map before `work` runs.
 * Identity-checked cleanup runs on both fulfillment and rejection so a failed
 * attempt is cleared and a later call can retry.
 */
export function shareInFlightByKey<T>(
  map: Map<string, Promise<T>>,
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  const existing = map.get(key);
  if (existing) return existing;

  let promise!: Promise<T>;
  // Defer `work` to a microtask so `map.set` below runs first (avoids sync
  // re-entrancy seeing a missing entry while work has already started).
  promise = Promise.resolve()
    .then(() => work())
    .finally(() => {
      if (map.get(key) === promise) {
        map.delete(key);
      }
    });

  map.set(key, promise);
  return promise;
}
