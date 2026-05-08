import { faker } from '@faker-js/faker';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newOrder, progressOrder, cancelOrder } from '../src/factories/order.js';
import { newProduct } from '../src/factories/product.js';
import { newCustomer } from '../src/factories/customer.js';

faker.seed(1);

const examplesDir = join(import.meta.dirname, '..', 'examples');

const order = newOrder({ shopName: 'dtc-apparel' });
const updated = progressOrder(order);
const cancelled = cancelOrder(updated);
const product = newProduct();
const customer = newCustomer();

const out: Array<[string, unknown]> = [
  ['orders-create.json', order],
  ['orders-updated.json', updated],
  ['orders-cancelled.json', cancelled],
  ['products-create.json', product],
  ['customers-create.json', customer],
];

for (const [name, payload] of out) {
  writeFileSync(join(examplesDir, name), JSON.stringify(payload, null, 2) + '\n');
  console.log('wrote', name);
}
