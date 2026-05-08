// Tracks entities the simulator has "created" so subsequent updates and
// cancellations reference real prior payloads. Bounded so memory stays flat
// during long runs — when full, oldest IDs roll off.

export interface Tracked<T> {
  id: number;
  shop: string;
  payload: T;
  createdAt: number;
}

export class EntityPool<T extends { id: number }> {
  private readonly items = new Map<number, Tracked<T>>();
  private readonly maxSize: number;

  constructor(maxSize = 5_000) {
    this.maxSize = maxSize;
  }

  add(shop: string, payload: T): void {
    if (this.items.size >= this.maxSize) {
      const oldestKey = this.items.keys().next().value;
      if (oldestKey !== undefined) this.items.delete(oldestKey);
    }
    this.items.set(payload.id, {
      id: payload.id,
      shop,
      payload,
      createdAt: Date.now(),
    });
  }

  update(payload: T): void {
    const existing = this.items.get(payload.id);
    if (existing) existing.payload = payload;
  }

  remove(id: number): void {
    this.items.delete(id);
  }

  size(): number {
    return this.items.size;
  }

  random(): Tracked<T> | undefined {
    if (this.items.size === 0) return undefined;
    const idx = Math.floor(Math.random() * this.items.size);
    let i = 0;
    for (const item of this.items.values()) {
      if (i === idx) return item;
      i++;
    }
    return undefined;
  }

  // Returns tracked entries sorted by id (ascending). Used by the backfill
  // REST mock for deterministic pagination.
  all(): Tracked<T>[] {
    return [...this.items.values()].sort((a, b) => a.id - b.id);
  }

  get(id: number): Tracked<T> | undefined {
    return this.items.get(id);
  }
}
