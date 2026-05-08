import { describe, it, expect, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';
import { cancelOrder, newOrder, progressOrder } from './order.js';

beforeEach(() => faker.seed(7));

describe('newOrder', () => {
  it('returns a valid pending Shopify-shaped order', () => {
    const order = newOrder();
    expect(order.id).toBeGreaterThan(0);
    expect(order.admin_graphql_api_id).toBe(`gid://shopify/Order/${order.id}`);
    expect(order.financial_status).toBe('pending');
    expect(order.fulfillment_status).toBeNull();
    expect(order.cancelled_at).toBeNull();
    expect(order.closed_at).toBeNull();
    expect(order.line_items.length).toBeGreaterThanOrEqual(1);
    expect(order.currency).toBe('USD');
    expect(order.name).toMatch(/^#\d+$/);
    expect(order.customer.id).toBeGreaterThan(0);
    expect(order.shipping_address.country_code).toBe('US');
  });

  it('totals are arithmetically consistent (subtotal - discount + tax + shipping ≈ total)', () => {
    for (let i = 0; i < 20; i++) {
      const order = newOrder();
      const subtotal = parseFloat(order.subtotal_price);
      const discount = parseFloat(order.total_discounts);
      const tax = parseFloat(order.total_tax);
      const ship = parseFloat(order.total_shipping_price_set.shop_money.amount);
      const total = parseFloat(order.total_price);
      const computed = subtotal - discount + tax + ship;
      expect(Math.abs(computed - total)).toBeLessThan(0.05);
    }
  });

  it('every line item has a non-empty SKU and positive quantity', () => {
    const order = newOrder();
    for (const li of order.line_items) {
      expect(li.sku).toMatch(/^[A-Z]+-[A-Z]{3}-(XS|S|M|L|XL|XXL)$/);
      expect(li.quantity).toBeGreaterThan(0);
      expect(parseFloat(li.price)).toBeGreaterThan(0);
    }
  });

  it('respects shopName override in order_status_url', () => {
    const order = newOrder({ shopName: 'cool-shop' });
    expect(order.order_status_url).toContain('cool-shop.myshopify.com');
  });
});

describe('progressOrder', () => {
  it('moves a pending order to paid', () => {
    const initial = newOrder();
    const next = progressOrder(initial);
    expect(next.financial_status).toBe('paid');
    expect(next.fulfillment_status).toBeNull();
    expect(next.id).toBe(initial.id);
    expect(next.updated_at >= initial.updated_at).toBe(true);
  });

  it('moves a paid order to fulfilled and adds a fulfillment record', () => {
    const initial = newOrder();
    const paid = progressOrder(initial);
    const fulfilled = progressOrder(paid);
    expect(fulfilled.financial_status).toBe('paid');
    expect(fulfilled.fulfillment_status).toBe('fulfilled');
    expect(fulfilled.fulfillments).toHaveLength(1);
    expect(fulfilled.fulfillments[0]!.tracking_number).toBeTruthy();
    expect(fulfilled.line_items.every((li) => li.fulfillment_status === 'fulfilled')).toBe(true);
  });

  it('after fulfillment, further updates leave status untouched but bump updated_at', () => {
    const initial = newOrder();
    const fulfilled = progressOrder(progressOrder(initial));
    const tweaked = progressOrder(fulfilled);
    expect(tweaked.financial_status).toBe('paid');
    expect(tweaked.fulfillment_status).toBe('fulfilled');
    expect(tweaked.updated_at >= fulfilled.updated_at).toBe(true);
  });
});

describe('cancelOrder', () => {
  it('cancels a paid order with refunded financial status', () => {
    const initial = newOrder();
    const paid = progressOrder(initial);
    const cancelled = cancelOrder(paid);
    expect(cancelled.cancelled_at).not.toBeNull();
    expect(cancelled.closed_at).not.toBeNull();
    expect(cancelled.financial_status).toBe('refunded');
    expect(cancelled.cancel_reason).toBeTruthy();
  });

  it('cancels a pending order with voided financial status', () => {
    const initial = newOrder();
    const cancelled = cancelOrder(initial);
    expect(cancelled.financial_status).toBe('voided');
  });

  it('restocks line items when cancelling a fulfilled order', () => {
    const initial = newOrder();
    const fulfilled = progressOrder(progressOrder(initial));
    const cancelled = cancelOrder(fulfilled);
    expect(cancelled.fulfillment_status).toBe('restocked');
  });
});
