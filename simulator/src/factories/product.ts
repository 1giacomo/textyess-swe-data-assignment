import { faker } from '@faker-js/faker';
import { COLORS, SIZES, apparelTitle, gid, isoNow, money, shopifyId } from './common.js';

export interface ShopifyVariant {
  id: number;
  product_id: number;
  title: string;
  price: string;
  sku: string;
  position: number;
  inventory_policy: 'deny' | 'continue';
  compare_at_price: string | null;
  fulfillment_service: 'manual';
  inventory_management: 'shopify' | null;
  option1: string;
  option2: string | null;
  option3: string | null;
  created_at: string;
  updated_at: string;
  taxable: boolean;
  barcode: string | null;
  grams: number;
  weight: number;
  weight_unit: 'g' | 'kg' | 'oz' | 'lb';
  inventory_item_id: number;
  inventory_quantity: number;
  requires_shipping: boolean;
  admin_graphql_api_id: string;
}

export interface ShopifyProduct {
  id: number;
  admin_graphql_api_id: string;
  title: string;
  body_html: string;
  vendor: string;
  product_type: string;
  handle: string;
  status: 'active' | 'archived' | 'draft';
  published_scope: 'global' | 'web';
  tags: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  template_suffix: string | null;
  variants: ShopifyVariant[];
  options: Array<{ id: number; product_id: number; name: string; position: number; values: string[] }>;
  images: Array<{ id: number; product_id: number; position: number; src: string; alt: string | null; width: number; height: number }>;
  image: { id: number; product_id: number; src: string } | null;
}

function sku(title: string, color: string, size: string): string {
  const base = title
    .replace(/[^A-Za-z]/g, '')
    .slice(0, 4)
    .toUpperCase();
  return `${base}-${color.slice(0, 3).toUpperCase()}-${size}`;
}

export function newProduct(overrides: Partial<ShopifyProduct> = {}): ShopifyProduct {
  const id = shopifyId();
  const title = apparelTitle();
  const ts = isoNow();
  const colors = faker.helpers.arrayElements(COLORS, { min: 2, max: 4 });
  const sizes = faker.helpers.arrayElements(SIZES, { min: 3, max: 6 });
  const basePrice = faker.number.float({ min: 18, max: 140, fractionDigits: 2 });

  const variants: ShopifyVariant[] = [];
  let pos = 1;
  for (const color of colors) {
    for (const size of sizes) {
      const variantId = shopifyId();
      variants.push({
        id: variantId,
        product_id: id,
        title: `${color} / ${size}`,
        price: money(basePrice),
        sku: sku(title, color, size),
        position: pos++,
        inventory_policy: 'deny',
        compare_at_price: faker.helpers.maybe(() => money(basePrice * 1.3), { probability: 0.2 }) ?? null,
        fulfillment_service: 'manual',
        inventory_management: 'shopify',
        option1: color,
        option2: size,
        option3: null,
        created_at: ts,
        updated_at: ts,
        taxable: true,
        barcode: null,
        grams: faker.number.int({ min: 80, max: 800 }),
        weight: 0,
        weight_unit: 'g',
        inventory_item_id: shopifyId(),
        inventory_quantity: faker.number.int({ min: 0, max: 500 }),
        requires_shipping: true,
        admin_graphql_api_id: gid('ProductVariant', variantId),
      });
    }
  }

  const handle = faker.helpers.slugify(title).toLowerCase();

  return {
    id,
    admin_graphql_api_id: gid('Product', id),
    title,
    body_html: `<p>${faker.commerce.productDescription()}</p>`,
    vendor: 'Apparel Co.',
    product_type: title.split(' ').at(-1) ?? 'Apparel',
    handle,
    status: 'active',
    published_scope: 'global',
    tags: faker.helpers.arrayElements(['new-arrival', 'bestseller', 'unisex', 'mens', 'womens', 'sale'], { min: 1, max: 3 }).join(', '),
    created_at: ts,
    updated_at: ts,
    published_at: ts,
    template_suffix: null,
    variants,
    options: [
      { id: shopifyId(), product_id: id, name: 'Color', position: 1, values: [...colors] },
      { id: shopifyId(), product_id: id, name: 'Size', position: 2, values: [...sizes] },
    ],
    images: [],
    image: null,
    ...overrides,
  };
}

export function updateProduct(existing: ShopifyProduct): ShopifyProduct {
  // Simulate inventory tick + occasional price/status changes.
  const variants = existing.variants.map((v) => ({
    ...v,
    inventory_quantity: Math.max(0, v.inventory_quantity + faker.number.int({ min: -10, max: 10 })),
    updated_at: isoNow(),
  }));
  const statusChange = faker.datatype.boolean({ probability: 0.05 });
  return {
    ...existing,
    variants,
    status: statusChange ? faker.helpers.arrayElement(['active', 'draft', 'archived'] as const) : existing.status,
    updated_at: isoNow(),
  };
}
