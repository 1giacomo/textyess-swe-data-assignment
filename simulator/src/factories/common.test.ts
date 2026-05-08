import { describe, it, expect, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';
import { address, apparelTitle, COLORS, gid, isoNow, money, shopifyId, SIZES } from './common.js';

beforeEach(() => faker.seed(42));

describe('common factories', () => {
  it('shopifyId stays inside JS-safe integer range', () => {
    for (let i = 0; i < 100; i++) {
      const id = shopifyId();
      expect(id).toBeGreaterThanOrEqual(1_000_000_000);
      expect(id).toBeLessThan(Number.MAX_SAFE_INTEGER);
    }
  });

  it('isoNow returns a parseable ISO 8601 timestamp', () => {
    const now = isoNow();
    expect(now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(Number.isFinite(Date.parse(now))).toBe(true);
  });

  it('money formats to two decimals', () => {
    expect(money(0)).toBe('0.00');
    expect(money(1)).toBe('1.00');
    expect(money(1.005)).toMatch(/^1\.0[01]$/); // floating point — allow either rounding
    expect(money(19.999)).toBe('20.00');
  });

  it('gid follows the gid://shopify/<Resource>/<id> format', () => {
    expect(gid('Order', 123)).toBe('gid://shopify/Order/123');
    expect(gid('Product', 9)).toBe('gid://shopify/Product/9');
    expect(gid('Customer', 1)).toBe('gid://shopify/Customer/1');
    expect(gid('ProductVariant', 5)).toBe('gid://shopify/ProductVariant/5');
  });

  it('apparelTitle composes adjective + material + category', () => {
    const title = apparelTitle();
    const parts = title.split(' ');
    expect(parts.length).toBeGreaterThanOrEqual(3);
  });

  it('exposes apparel size and color taxonomies', () => {
    expect(SIZES).toContain('M');
    expect(SIZES).toContain('XXL');
    expect(COLORS).toContain('Black');
    expect(COLORS.length).toBeGreaterThan(5);
  });

  it('address returns a US address with required fields', () => {
    const a = address('Jane', 'Doe');
    expect(a.first_name).toBe('Jane');
    expect(a.last_name).toBe('Doe');
    expect(a.name).toBe('Jane Doe');
    expect(a.country_code).toBe('US');
    expect(a.address1).toBeTruthy();
    expect(a.city).toBeTruthy();
    expect(a.zip).toBeTruthy();
  });

  it('faker seed makes data deterministic', () => {
    faker.seed(123);
    const a1 = address();
    faker.seed(123);
    const a2 = address();
    expect(a1).toEqual(a2);
  });
});
