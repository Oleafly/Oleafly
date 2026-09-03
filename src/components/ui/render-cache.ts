interface CacheEntry<T> {
  value: T;
  weight: number;
}

export class RenderCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private totalWeight = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxWeight: number,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  get weight(): number {
    return this.totalWeight;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, weight = 1): void {
    const existing = this.entries.get(key);
    if (existing) {
      this.totalWeight -= existing.weight;
      this.entries.delete(key);
    }
    const normalized = Math.max(1, weight);
    this.entries.set(key, { value, weight: normalized });
    this.totalWeight += normalized;
    this.evict();
  }

  clear(): void {
    this.entries.clear();
    this.totalWeight = 0;
  }

  private evict(): void {
    while (
      this.entries.size > 1 &&
      (this.entries.size > this.maxEntries || this.totalWeight > this.maxWeight)
    ) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) return;
      const entry = this.entries.get(oldest);
      this.entries.delete(oldest);
      if (entry) this.totalWeight -= entry.weight;
    }
  }
}
