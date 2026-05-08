import { faker } from '@faker-js/faker';
import { address, gid, isoNow, shopifyId, type Address } from './common.js';

export interface ShopifyCustomer {
  id: number;
  admin_graphql_api_id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  state: 'enabled' | 'disabled' | 'invited' | 'declined';
  verified_email: boolean;
  tax_exempt: boolean;
  tags: string;
  currency: string;
  accepts_marketing: boolean;
  marketing_opt_in_level: 'single_opt_in' | 'confirmed_opt_in' | 'unknown' | null;
  created_at: string;
  updated_at: string;
  orders_count: number;
  total_spent: string;
  last_order_id: number | null;
  last_order_name: string | null;
  note: string | null;
  addresses: Address[];
  default_address: Address;
}

export function newCustomer(overrides: Partial<ShopifyCustomer> = {}): ShopifyCustomer {
  const id = shopifyId();
  const first = faker.person.firstName();
  const last = faker.person.lastName();
  const email = faker.internet.email({ firstName: first, lastName: last }).toLowerCase();
  const addr = address(first, last);
  const orders = faker.number.int({ min: 0, max: 12 });
  const ts = isoNow();
  return {
    id,
    admin_graphql_api_id: gid('Customer', id),
    email,
    first_name: first,
    last_name: last,
    phone: addr.phone,
    state: 'enabled',
    verified_email: faker.datatype.boolean({ probability: 0.85 }),
    tax_exempt: false,
    tags: faker.helpers.arrayElements(['vip', 'returning', 'subscriber', 'wholesale'], { min: 0, max: 2 }).join(', '),
    currency: 'USD',
    accepts_marketing: faker.datatype.boolean({ probability: 0.6 }),
    marketing_opt_in_level: 'single_opt_in',
    created_at: ts,
    updated_at: ts,
    orders_count: orders,
    total_spent: (orders * faker.number.float({ min: 30, max: 200, fractionDigits: 2 })).toFixed(2),
    last_order_id: null,
    last_order_name: null,
    note: null,
    addresses: [addr],
    default_address: addr,
    ...overrides,
  };
}

export function updateCustomer(existing: ShopifyCustomer): ShopifyCustomer {
  return {
    ...existing,
    accepts_marketing: !existing.accepts_marketing,
    tags: faker.helpers.arrayElements(['vip', 'returning', 'subscriber', 'wholesale', 'churn-risk'], { min: 0, max: 3 }).join(', '),
    updated_at: isoNow(),
  };
}
