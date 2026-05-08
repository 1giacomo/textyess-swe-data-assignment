import { describe, it, expect } from 'vitest';
import { EntityPool } from './state.js';

interface Item {
  id: number;
  v: number;
}

describe('EntityPool', () => {
  it('add/random/remove round-trips a single item', () => {
    const pool = new EntityPool<Item>();
    pool.add('shop-a', { id: 1, v: 1 });
    expect(pool.size()).toBe(1);

    const tracked = pool.random();
    expect(tracked).toBeDefined();
    expect(tracked!.payload.id).toBe(1);
    expect(tracked!.shop).toBe('shop-a');

    pool.remove(1);
    expect(pool.size()).toBe(0);
    expect(pool.random()).toBeUndefined();
  });

  it('update mutates an existing entry by id', () => {
    const pool = new EntityPool<Item>();
    pool.add('shop-a', { id: 7, v: 1 });
    pool.update({ id: 7, v: 99 });

    const tracked = pool.random();
    expect(tracked!.payload.v).toBe(99);
  });

  it('update is a no-op when the id is unknown', () => {
    const pool = new EntityPool<Item>();
    pool.add('shop-a', { id: 1, v: 1 });
    pool.update({ id: 999, v: 99 });
    expect(pool.size()).toBe(1);
  });

  it('evicts the oldest entry once maxSize is exceeded', () => {
    const pool = new EntityPool<Item>(3);
    pool.add('shop-a', { id: 1, v: 1 });
    pool.add('shop-a', { id: 2, v: 2 });
    pool.add('shop-a', { id: 3, v: 3 });
    pool.add('shop-a', { id: 4, v: 4 }); // should evict id=1
    expect(pool.size()).toBe(3);

    // Sample many times; id=1 should never come back, id=4 should appear.
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(pool.random()!.payload.id);
    expect(seen.has(1)).toBe(false);
    expect(seen.has(4)).toBe(true);
  });

  it('random() returns undefined on an empty pool', () => {
    expect(new EntityPool<Item>().random()).toBeUndefined();
  });
});
