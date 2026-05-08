import { describe, it, expect, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';
import { newProduct, updateProduct } from './product.js';

beforeEach(() => faker.seed(11));

describe('newProduct', () => {
  it('returns a valid Shopify-shaped product', () => {
    const p = newProduct();
    expect(p.id).toBeGreaterThan(0);
    expect(p.admin_graphql_api_id).toBe(`gid://shopify/Product/${p.id}`);
    expect(p.status).toBe('active');
    expect(p.handle).toMatch(/^[a-z0-9-]+$/);
    expect(p.options).toHaveLength(2);
    expect(p.options.map((o) => o.name).sort()).toEqual(['Color', 'Size']);
  });

  it('variants are the cartesian product of color × size options', () => {
    const p = newProduct();
    const colors = p.options.find((o) => o.name === 'Color')!.values;
    const sizes = p.options.find((o) => o.name === 'Size')!.values;
    expect(p.variants).toHaveLength(colors.length * sizes.length);

    const seen = new Set(p.variants.map((v) => `${v.option1}/${v.option2}`));
    for (const c of colors) for (const s of sizes) expect(seen.has(`${c}/${s}`)).toBe(true);
  });

  it('every variant has a positive price and an inventory_quantity in [0, 500]', () => {
    const p = newProduct();
    for (const v of p.variants) {
      expect(parseFloat(v.price)).toBeGreaterThan(0);
      expect(v.sku).toBeTruthy();
      expect(v.inventory_quantity).toBeGreaterThanOrEqual(0);
      expect(v.inventory_quantity).toBeLessThanOrEqual(500);
      expect(v.product_id).toBe(p.id);
    }
  });

  it('all variants share the same base price (color × size are price-uniform)', () => {
    const p = newProduct();
    const prices = new Set(p.variants.map((v) => v.price));
    expect(prices.size).toBe(1);
  });
});

describe('updateProduct', () => {
  it('keeps the same id and variant ids but bumps updated_at', () => {
    const p = newProduct();
    const updated = updateProduct(p);
    expect(updated.id).toBe(p.id);
    expect(updated.variants.map((v) => v.id)).toEqual(p.variants.map((v) => v.id));
    expect(updated.updated_at >= p.updated_at).toBe(true);
  });

  it('inventory stays non-negative after multiple ticks', () => {
    let p = newProduct();
    for (let i = 0; i < 50; i++) p = updateProduct(p);
    for (const v of p.variants) expect(v.inventory_quantity).toBeGreaterThanOrEqual(0);
  });
});
