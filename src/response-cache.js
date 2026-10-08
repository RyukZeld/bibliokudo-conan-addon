/**
 * Tiny in-memory TTL cache for hot meta / subtitle responses.
 * Caps size to avoid unbounded growth on long-running hosts.
 */

const DEFAULT_MAX = 400;

export function createTtlCache({ max = DEFAULT_MAX, name = 'cache' } = {}) {
  const map = new Map(); // key -> { value, expires }

  function get(key) {
    const hit = map.get(key);
    if (!hit) return undefined;
    if (hit.expires <= Date.now()) {
      map.delete(key);
      return undefined;
    }
    // refresh LRU order
    map.delete(key);
    map.set(key, hit);
    return hit.value;
  }

  function set(key, value, ttlMs) {
    if (map.size >= max) {
      const oldest = map.keys().next().value;
      map.delete(oldest);
    }
    map.set(key, { value, expires: Date.now() + ttlMs });
  }

  function stats() {
    return { name, size: map.size, max };
  }

  function clear() {
    map.clear();
  }

  return { get, set, stats, clear };
}
