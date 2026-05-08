import { faker } from '@faker-js/faker';
import { COLORS, SIZES, address, apparelTitle, gid, isoNow, money, shopifyId, type Address } from './common.js';

export type FinancialStatus = 'pending' | 'authorized' | 'paid' | 'partially_paid' | 'refunded' | 'partially_refunded' | 'voided';
export type FulfillmentStatus = null | 'fulfilled' | 'partial' | 'restocked';

export interface ShopifyLineItem {
  id: number;
  admin_graphql_api_id: string;
  product_id: number;
  variant_id: number;
  title: string;
  variant_title: string;
  sku: string;
  vendor: string;
  quantity: number;
  price: string;
  total_discount: string;
  fulfillment_status: FulfillmentStatus;
  product_exists: boolean;
  requires_shipping: boolean;
  taxable: boolean;
  gift_card: boolean;
  name: string;
  grams: number;
  properties: Array<{ name: string; value: string }>;
}

export interface ShopifyOrder {
  id: number;
  admin_graphql_api_id: string;
  app_id: number | null;
  browser_ip: string | null;
  buyer_accepts_marketing: boolean;
  cancel_reason: string | null;
  cancelled_at: string | null;
  cart_token: string | null;
  checkout_id: number;
  checkout_token: string;
  closed_at: string | null;
  confirmation_number: string;
  confirmed: boolean;
  contact_email: string;
  created_at: string;
  currency: 'USD';
  current_subtotal_price: string;
  current_total_discounts: string;
  current_total_price: string;
  current_total_tax: string;
  customer_locale: string;
  email: string;
  estimated_taxes: boolean;
  financial_status: FinancialStatus;
  fulfillment_status: FulfillmentStatus;
  landing_site: string | null;
  name: string;
  note: string | null;
  number: number;
  order_number: number;
  order_status_url: string;
  payment_gateway_names: string[];
  phone: string | null;
  presentment_currency: 'USD';
  processed_at: string;
  reference: string | null;
  referring_site: string | null;
  source_identifier: string | null;
  source_name: 'web' | 'shopify_draft_order' | 'pos' | 'subscriptions';
  source_url: string | null;
  subtotal_price: string;
  tags: string;
  tax_exempt: boolean;
  taxes_included: boolean;
  test: boolean;
  token: string;
  total_discounts: string;
  total_line_items_price: string;
  total_outstanding: string;
  total_price: string;
  total_shipping_price_set: { shop_money: { amount: string; currency_code: 'USD' }; presentment_money: { amount: string; currency_code: 'USD' } };
  total_tax: string;
  total_tip_received: string;
  total_weight: number;
  updated_at: string;
  user_id: number | null;
  customer: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
    state: 'enabled' | 'disabled' | 'invited' | 'declined';
    created_at: string;
    updated_at: string;
    orders_count: number;
    total_spent: string;
    admin_graphql_api_id: string;
  };
  billing_address: Address;
  shipping_address: Address;
  line_items: ShopifyLineItem[];
  discount_codes: Array<{ code: string; amount: string; type: 'percentage' | 'fixed_amount' | 'shipping' }>;
  shipping_lines: Array<{ id: number; title: string; price: string; code: string; source: string; carrier_identifier: string | null; discounted_price: string }>;
  fulfillments: Array<{
    id: number;
    order_id: number;
    status: 'pending' | 'open' | 'success' | 'cancelled' | 'error' | 'failure';
    created_at: string;
    updated_at: string;
    tracking_company: string | null;
    tracking_number: string | null;
    tracking_url: string | null;
  }>;
  refunds: Array<{ id: number; order_id: number; created_at: string; processed_at: string; note: string | null; amount: string }>;
}

const PAYMENT_GATEWAYS = ['shopify_payments', 'paypal', 'manual'] as const;

function randomLineItem(orderId: number): ShopifyLineItem {
  const id = shopifyId();
  const productId = shopifyId();
  const variantId = shopifyId();
  const title = apparelTitle();
  const color = faker.helpers.arrayElement(COLORS);
  const size = faker.helpers.arrayElement(SIZES);
  const variantTitle = `${color} / ${size}`;
  const skuPart = title
    .replace(/[^A-Za-z]/g, '')
    .slice(0, 4)
    .toUpperCase();
  const price = faker.number.float({ min: 18, max: 140, fractionDigits: 2 });
  const quantity = faker.helpers.weightedArrayElement([
    { value: 1, weight: 60 },
    { value: 2, weight: 25 },
    { value: 3, weight: 10 },
    { value: 4, weight: 5 },
  ]);
  return {
    id,
    admin_graphql_api_id: `gid://shopify/LineItem/${id}`,
    product_id: productId,
    variant_id: variantId,
    title,
    variant_title: variantTitle,
    sku: `${skuPart}-${color.slice(0, 3).toUpperCase()}-${size}`,
    vendor: 'Apparel Co.',
    quantity,
    price: money(price),
    total_discount: '0.00',
    fulfillment_status: null,
    product_exists: true,
    requires_shipping: true,
    taxable: true,
    gift_card: false,
    name: `${title} - ${variantTitle}`,
    grams: faker.number.int({ min: 100, max: 700 }),
    properties: [],
  };
}

function totals(lineItems: ShopifyLineItem[], discountAmount: number, shippingPrice: number) {
  const subtotal = lineItems.reduce((s, li) => s + parseFloat(li.price) * li.quantity, 0);
  const taxable = Math.max(0, subtotal - discountAmount);
  const tax = +(taxable * 0.08).toFixed(2);
  const total = +(taxable + tax + shippingPrice).toFixed(2);
  return { subtotal: +subtotal.toFixed(2), tax, total };
}

export interface NewOrderOptions {
  customerOverride?: Partial<ShopifyOrder['customer']>;
  shopName?: string;
}

export function newOrder(opts: NewOrderOptions = {}): ShopifyOrder {
  const id = shopifyId();
  const orderNumber = faker.number.int({ min: 1001, max: 999_999 });
  const ts = isoNow();
  const itemCount = faker.helpers.weightedArrayElement([
    { value: 1, weight: 50 },
    { value: 2, weight: 30 },
    { value: 3, weight: 12 },
    { value: 4, weight: 5 },
    { value: 5, weight: 3 },
  ]);
  const lineItems = Array.from({ length: itemCount }, () => randomLineItem(id));
  const hasDiscount = faker.datatype.boolean({ probability: 0.25 });
  const discountAmount = hasDiscount ? faker.number.float({ min: 5, max: 30, fractionDigits: 2 }) : 0;
  const shippingPrice = faker.helpers.arrayElement([0, 5.99, 9.99, 14.99]);
  const { subtotal, tax, total } = totals(lineItems, discountAmount, shippingPrice);

  const first = faker.person.firstName();
  const last = faker.person.lastName();
  const email = faker.internet.email({ firstName: first, lastName: last }).toLowerCase();
  const billing = address(first, last);
  const shipping = address(first, last);
  const customerId = shopifyId();

  return {
    id,
    admin_graphql_api_id: gid('Order', id),
    app_id: null,
    browser_ip: faker.internet.ip(),
    buyer_accepts_marketing: faker.datatype.boolean({ probability: 0.5 }),
    cancel_reason: null,
    cancelled_at: null,
    cart_token: faker.string.alphanumeric(32),
    checkout_id: shopifyId(),
    checkout_token: faker.string.alphanumeric(32),
    closed_at: null,
    confirmation_number: faker.string.alphanumeric({ length: 9, casing: 'upper' }),
    confirmed: true,
    contact_email: email,
    created_at: ts,
    currency: 'USD',
    current_subtotal_price: money(subtotal),
    current_total_discounts: money(discountAmount),
    current_total_price: money(total),
    current_total_tax: money(tax),
    customer_locale: 'en-US',
    email,
    estimated_taxes: false,
    financial_status: 'pending',
    fulfillment_status: null,
    landing_site: '/products',
    name: `#${orderNumber}`,
    note: null,
    number: orderNumber,
    order_number: orderNumber,
    order_status_url: `https://${opts.shopName ?? 'dtc-apparel'}.myshopify.com/orders/${faker.string.alphanumeric(32)}`,
    payment_gateway_names: [faker.helpers.arrayElement(PAYMENT_GATEWAYS)],
    phone: billing.phone,
    presentment_currency: 'USD',
    processed_at: ts,
    reference: null,
    referring_site: null,
    source_identifier: null,
    source_name: faker.helpers.weightedArrayElement([
      { value: 'web', weight: 80 },
      { value: 'pos', weight: 10 },
      { value: 'shopify_draft_order', weight: 5 },
      { value: 'subscriptions', weight: 5 },
    ]),
    source_url: null,
    subtotal_price: money(subtotal),
    tags: '',
    tax_exempt: false,
    taxes_included: false,
    test: false,
    token: faker.string.alphanumeric(32),
    total_discounts: money(discountAmount),
    total_line_items_price: money(subtotal),
    total_outstanding: money(total),
    total_price: money(total),
    total_shipping_price_set: {
      shop_money: { amount: money(shippingPrice), currency_code: 'USD' },
      presentment_money: { amount: money(shippingPrice), currency_code: 'USD' },
    },
    total_tax: money(tax),
    total_tip_received: '0.00',
    total_weight: lineItems.reduce((s, li) => s + li.grams * li.quantity, 0),
    updated_at: ts,
    user_id: null,
    customer: {
      id: customerId,
      email,
      first_name: first,
      last_name: last,
      state: 'enabled',
      created_at: ts,
      updated_at: ts,
      orders_count: faker.number.int({ min: 1, max: 30 }),
      total_spent: money(total * faker.number.float({ min: 1, max: 5, fractionDigits: 2 })),
      admin_graphql_api_id: gid('Customer', customerId),
      ...opts.customerOverride,
    },
    billing_address: billing,
    shipping_address: shipping,
    line_items: lineItems,
    discount_codes: hasDiscount
      ? [{ code: faker.string.alpha({ length: 8, casing: 'upper' }), amount: money(discountAmount), type: 'fixed_amount' }]
      : [],
    shipping_lines: [
      {
        id: shopifyId(),
        title: shippingPrice === 0 ? 'Free Shipping' : 'Standard',
        price: money(shippingPrice),
        code: shippingPrice === 0 ? 'FREE' : 'STANDARD',
        source: 'shopify',
        carrier_identifier: null,
        discounted_price: money(shippingPrice),
      },
    ],
    fulfillments: [],
    refunds: [],
  };
}

// Move an order forward in its lifecycle: pending -> paid -> fulfilled.
export function progressOrder(order: ShopifyOrder): ShopifyOrder {
  const next = { ...order, updated_at: isoNow() };

  if (order.financial_status === 'pending') {
    next.financial_status = 'paid';
    return next;
  }

  if (order.fulfillment_status === null && order.financial_status === 'paid') {
    next.fulfillment_status = 'fulfilled';
    next.line_items = order.line_items.map((li) => ({ ...li, fulfillment_status: 'fulfilled' }));
    const fulfillmentId = shopifyId();
    next.fulfillments = [
      {
        id: fulfillmentId,
        order_id: order.id,
        status: 'success',
        created_at: isoNow(),
        updated_at: isoNow(),
        tracking_company: faker.helpers.arrayElement(['UPS', 'USPS', 'FedEx', 'DHL']),
        tracking_number: faker.string.alphanumeric({ length: 16, casing: 'upper' }),
        tracking_url: null,
      },
    ];
    return next;
  }

  // Otherwise: small mutations (note added, tags edited).
  next.note = faker.lorem.sentence();
  next.tags = faker.helpers.arrayElements(['rush', 'gift', 'b2b', 'flagged'], { min: 0, max: 2 }).join(', ');
  return next;
}

export function cancelOrder(order: ShopifyOrder): ShopifyOrder {
  return {
    ...order,
    cancel_reason: faker.helpers.arrayElement(['customer', 'fraud', 'inventory', 'declined', 'other']),
    cancelled_at: isoNow(),
    closed_at: isoNow(),
    financial_status: order.financial_status === 'paid' ? 'refunded' : 'voided',
    fulfillment_status: order.fulfillment_status === 'fulfilled' ? 'restocked' : null,
    updated_at: isoNow(),
  };
}
