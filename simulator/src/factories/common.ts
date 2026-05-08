import { faker } from '@faker-js/faker';

// Shopify uses 64-bit numeric IDs. JS numbers are safe up to 2^53, which is
// plenty of headroom for synthetic IDs.
export function shopifyId(): number {
  return faker.number.int({ min: 1_000_000_000, max: 9_999_999_999_999 });
}

export function isoNow(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

export function money(amount: number): string {
  return amount.toFixed(2);
}

export function gid(resource: 'Order' | 'Product' | 'Customer' | 'ProductVariant', id: number): string {
  return `gid://shopify/${resource}/${id}`;
}

const APPAREL_CATEGORIES = [
  'T-Shirts',
  'Hoodies',
  'Joggers',
  'Dresses',
  'Jeans',
  'Jackets',
  'Activewear',
  'Underwear',
  'Socks',
  'Hats',
] as const;

const APPAREL_ADJECTIVES = [
  'Classic',
  'Vintage',
  'Oversized',
  'Slim',
  'Relaxed',
  'Cropped',
  'Premium',
  'Essential',
  'Heritage',
  'Limited',
] as const;

const APPAREL_MATERIALS = [
  'Cotton',
  'Linen',
  'Fleece',
  'Denim',
  'Jersey',
  'Knit',
  'Twill',
  'Modal',
] as const;

export function apparelTitle(): string {
  return [
    faker.helpers.arrayElement(APPAREL_ADJECTIVES),
    faker.helpers.arrayElement(APPAREL_MATERIALS),
    faker.helpers.arrayElement(APPAREL_CATEGORIES).replace(/s$/, ''),
  ].join(' ');
}

export const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const;
export const COLORS = [
  'Black',
  'White',
  'Navy',
  'Olive',
  'Charcoal',
  'Cream',
  'Sand',
  'Rust',
  'Forest',
  'Burgundy',
] as const;

export type Address = {
  first_name: string;
  last_name: string;
  company: string | null;
  address1: string;
  address2: string | null;
  city: string;
  province: string;
  province_code: string;
  country: string;
  country_code: string;
  zip: string;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  name: string;
};

export function address(firstName?: string, lastName?: string): Address {
  const first = firstName ?? faker.person.firstName();
  const last = lastName ?? faker.person.lastName();
  return {
    first_name: first,
    last_name: last,
    company: faker.helpers.maybe(() => faker.company.name(), { probability: 0.1 }) ?? null,
    address1: faker.location.streetAddress(),
    address2: faker.helpers.maybe(() => faker.location.secondaryAddress(), { probability: 0.2 }) ?? null,
    city: faker.location.city(),
    province: faker.location.state(),
    province_code: faker.location.state({ abbreviated: true }),
    country: 'United States',
    country_code: 'US',
    zip: faker.location.zipCode(),
    phone: faker.helpers.maybe(() => faker.phone.number(), { probability: 0.6 }) ?? null,
    latitude: faker.location.latitude(),
    longitude: faker.location.longitude(),
    name: `${first} ${last}`,
  };
}
