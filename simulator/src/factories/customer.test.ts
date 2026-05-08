import { describe, it, expect, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';
import { newCustomer, updateCustomer } from './customer.js';

beforeEach(() => faker.seed(13));

describe('newCustomer', () => {
  it('returns a valid Shopify-shaped customer', () => {
    const c = newCustomer();
    expect(c.id).toBeGreaterThan(0);
    expect(c.admin_graphql_api_id).toBe(`gid://shopify/Customer/${c.id}`);
    expect(c.email).toMatch(/@/);
    expect(c.email).toBe(c.email.toLowerCase());
    expect(c.first_name).toBeTruthy();
    expect(c.last_name).toBeTruthy();
    expect(c.state).toBe('enabled');
    expect(c.currency).toBe('USD');
    expect(c.addresses).toHaveLength(1);
    expect(c.default_address).toEqual(c.addresses[0]);
  });

  it('total_spent is a parseable money string', () => {
    const c = newCustomer();
    expect(c.total_spent).toMatch(/^\d+\.\d{2}$/);
    expect(parseFloat(c.total_spent)).toBeGreaterThanOrEqual(0);
  });
});

describe('updateCustomer', () => {
  it('toggles accepts_marketing and bumps updated_at', () => {
    const before = newCustomer();
    const after = updateCustomer(before);
    expect(after.id).toBe(before.id);
    expect(after.accepts_marketing).toBe(!before.accepts_marketing);
    expect(after.updated_at >= before.updated_at).toBe(true);
  });
});
