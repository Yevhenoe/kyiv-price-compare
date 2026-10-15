// Простий TTL-кеш у пам'яті
export class Cache {
  constructor(ttlSec, max = 5000) {
    this.ttl = ttlSec * 1000;
    this.max = max;
    this.map = new Map();
  }

  get(key) {
    const hit = this.map.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    this.map.delete(key);
    return undefined;
  }

  set(key, value) {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value);
    this.map.set(key, { value, expires: Date.now() + this.ttl });
    return value;
  }

  async wrap(key, fn) {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    return this.set(key, await fn());
  }
}

// Виконує async-функції з обмеженням паралельності
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}
