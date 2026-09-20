/**
 * Share one in-flight Promise per key so concurrent callers reuse the same work.
 * Removes the map entry only when the exact stored promise completes.
 */
export function shareInFlightByKey<T>(
  map: Map<string, Promise<T>>,
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  const existing = map.get(key);
  if (existing) return existing;

  let promise!: Promise<T>;
  promise = (async () => {
    try {
      return await work();
    } finally {
      if (map.get(key) === promise) {
        map.delete(key);
      }
    }
  })();

  map.set(key, promise);
  return promise;
}
