import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { faker } from '@faker-js/faker';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import {
  bump,
  buildHeaders,
  CollectingSender,
  HttpSender,
  newPools,
  newStats,
  nextJob,
  pickShop,
  pickTopicGroup,
  run,
  type RunnerOptions,
  type Topic,
} from './runner.js';

function defaults(overrides: Partial<RunnerOptions> = {}): RunnerOptions {
  return {
    url: 'http://localhost:0',
    rps: 0,
    concurrency: 4,
    workload: 'steady',
    topics: 'orders',
    updateRate: 0,
    cancelRate: 0,
    duplicateRate: 0,
    dropRate: 0,
    outOfOrder: false,
    shops: 'dtc-apparel.myshopify.com',
    apiVersion: '2024-10',
    dryRun: false,
    verbose: false,
    inserts: 0,
    updates: 0,
    cancels: 0,
    ...overrides,
  };
}

describe('buildHeaders', () => {
  it('always includes the canonical Shopify headers', () => {
    const h = buildHeaders('orders/create', 'shop-a.myshopify.com', 1, '2024-10');
    expect(h['Content-Type']).toBe('application/json');
    expect(h['X-Shopify-Topic']).toBe('orders/create');
    expect(h['X-Shopify-Shop-Domain']).toBe('shop-a.myshopify.com');
    expect(h['X-Shopify-API-Version']).toBe('2024-10');
    expect(h['X-Shopify-Webhook-Id']).toMatch(/^[0-9a-f-]{36}$/i);
    expect(h['X-Shopify-Triggered-At']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('includes resource-specific id headers for each topic family', () => {
    expect(buildHeaders('orders/create', 'x', 100, 'v')['X-Shopify-Order-Id']).toBe('100');
    expect(buildHeaders('products/update', 'x', 200, 'v')['X-Shopify-Product-Id']).toBe('200');
    expect(buildHeaders('customers/update', 'x', 300, 'v')['X-Shopify-Customer-Id']).toBe('300');
  });

  it('does not leak resource-id headers across families', () => {
    const h = buildHeaders('orders/create', 'x', 1, 'v');
    expect(h['X-Shopify-Product-Id']).toBeUndefined();
    expect(h['X-Shopify-Customer-Id']).toBeUndefined();
  });
});

describe('Stats', () => {
  it('bump increments sent and the right ok/failed bucket', () => {
    const stats = newStats();
    bump(stats, 'orders/create', true);
    bump(stats, 'orders/create', false);
    bump(stats, 'orders/updated', true);
    expect(stats.sent).toBe(3);
    expect(stats.ok).toBe(2);
    expect(stats.failed).toBe(1);
    expect(stats.byTopic.get('orders/create')).toBe(2);
    expect(stats.byTopic.get('orders/updated')).toBe(1);
  });
});

describe('pickShop / pickTopicGroup', () => {
  it('pickShop returns one of the provided shops', () => {
    const shops = ['a', 'b', 'c'];
    for (let i = 0; i < 50; i++) expect(shops).toContain(pickShop(shops));
  });

  it('pickShop falls back when given an empty list', () => {
    expect(pickShop([])).toBe('dtc-apparel.myshopify.com');
  });

  it('pickTopicGroup maps strings to canonical groups', () => {
    expect(pickTopicGroup(['products'])).toBe('products');
    expect(pickTopicGroup(['customers'])).toBe('customers');
    expect(pickTopicGroup(['orders'])).toBe('orders');
    expect(pickTopicGroup(['anything-else'])).toBe('orders');
  });
});

describe('nextJob', () => {
  beforeEach(() => faker.seed(101));

  it('orders group with empty pool always emits orders/create regardless of rates', () => {
    for (let i = 0; i < 10; i++) {
      const pools = newPools(); // fresh empty pool each call
      const job = nextJob('orders', 'shop-a.myshopify.com', pools, { updateRate: 0.5, cancelRate: 0.5 });
      expect(job).not.toBeNull();
      expect(job!.topic).toBe('orders/create');
      expect(pools.orders.size()).toBe(1);
    }
  });

  it('orders group with updateRate=1 and a populated pool emits orders/updated', () => {
    const pools = newPools();
    nextJob('orders', 'shop-a.myshopify.com', pools, { updateRate: 0, cancelRate: 0 }); // seed create
    expect(pools.orders.size()).toBe(1);
    const job = nextJob('orders', 'shop-a.myshopify.com', pools, { updateRate: 1, cancelRate: 0 });
    expect(job!.topic).toBe('orders/updated');
    expect(pools.orders.size()).toBe(1); // update preserves
  });

  it('orders group with cancelRate=1 emits orders/updated and removes from pool', () => {
    const pools = newPools();
    nextJob('orders', 'shop-a.myshopify.com', pools, { updateRate: 0, cancelRate: 0 });
    expect(pools.orders.size()).toBe(1);
    const job = nextJob('orders', 'shop-a.myshopify.com', pools, { updateRate: 0, cancelRate: 1 });
    expect(job!.topic).toBe('orders/updated');
    expect((job!.payload as { cancelled_at: string | null }).cancelled_at).not.toBeNull();
    expect(pools.orders.size()).toBe(0);
  });

  it('products group with empty pool emits products/create', () => {
    const pools = newPools();
    const job = nextJob('products', 'shop-a.myshopify.com', pools, { updateRate: 0, cancelRate: 0 });
    expect(job!.topic).toBe('products/create');
    expect(pools.products.size()).toBe(1);
  });

  it('customers group with empty pool emits customers/create', () => {
    const pools = newPools();
    const job = nextJob('customers', 'shop-a.myshopify.com', pools, { updateRate: 0, cancelRate: 0 });
    expect(job!.topic).toBe('customers/create');
    expect(pools.customers.size()).toBe(1);
  });
});

describe('run() — burst workload', () => {
  it('emits exactly the requested number of orders against a CollectingSender', async () => {
    const sender = new CollectingSender();
    const stats = await run(defaults({ burst: 50, topics: 'orders', concurrency: 8, seed: 1 }), { sender });
    expect(stats.sent).toBe(50);
    expect(stats.ok).toBe(50);
    expect(sender.events).toHaveLength(50);
    expect(sender.events.every((e) => (e.topic as string).startsWith('orders/'))).toBe(true);
  });

  it('duplicateRate=1 doubles the events delivered', async () => {
    const sender = new CollectingSender();
    const stats = await run(defaults({ burst: 20, topics: 'orders', duplicateRate: 1, seed: 2 }), { sender });
    expect(stats.sent).toBe(40);
    expect(sender.events).toHaveLength(40);
  });
});

describe('run() — stress workload', () => {
  it('walks through insert → update → cancel phases in that order', async () => {
    const sender = new CollectingSender();
    const opts = defaults({ workload: 'stress', inserts: 5, updates: 3, cancels: 2, concurrency: 1, seed: 3 });
    await run(opts, { sender });

    expect(sender.events).toHaveLength(10);
    const topics = sender.events.map((e) => e.topic);
    expect(topics.slice(0, 5).every((t) => t === 'orders/create')).toBe(true);
    expect(topics.slice(5).every((t) => t === 'orders/updated')).toBe(true);

    const cancelled = sender.events
      .slice(8) // last 2 are cancels
      .map((e) => (e.payload as { cancelled_at: string | null }).cancelled_at);
    expect(cancelled.every((c) => c !== null)).toBe(true);
  });

  it('updates and cancels reference order ids that were previously created', async () => {
    const sender = new CollectingSender();
    await run(defaults({ workload: 'stress', inserts: 4, updates: 4, cancels: 2, concurrency: 1, seed: 4 }), { sender });

    const createdIds = new Set(sender.events.filter((e) => e.topic === 'orders/create').map((e) => e.resourceId));
    const mutatedIds = sender.events.filter((e) => e.topic === 'orders/updated').map((e) => e.resourceId);
    expect(mutatedIds.length).toBeGreaterThan(0);
    for (const id of mutatedIds) expect(createdIds.has(id)).toBe(true);
  });
});

describe('run() — steady workload aborts cleanly', () => {
  it('stops yielding when the AbortSignal fires', async () => {
    const sender = new CollectingSender();
    const ac = new AbortController();
    const promise = run(defaults({ rps: 1000, topics: 'orders', concurrency: 4, seed: 5 }), { sender, signal: ac.signal });

    // Let it run briefly, then abort.
    await new Promise((r) => setTimeout(r, 30));
    ac.abort();
    const stats = await promise;
    expect(stats.sent).toBeGreaterThan(0);
  });
});

describe('HttpSender against a live listener', () => {
  let server: Server;
  let url: string;
  const received: Array<{ headers: IncomingMessage['headers']; body: unknown }> = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          received.push({ headers: req.headers, body: JSON.parse(body) });
        } catch {
          received.push({ headers: req.headers, body });
        }
        res.statusCode = 200;
        res.end('ok');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    url = `http://127.0.0.1:${port}/webhooks`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    received.length = 0;
  });

  it('delivers events with valid headers and payload to the endpoint', async () => {
    const sender = new HttpSender(url, '2024-10', false);
    const stats = await run(defaults({ url, burst: 8, topics: 'orders', concurrency: 4, seed: 9 }), { sender });

    expect(stats.ok).toBe(8);
    expect(received).toHaveLength(8);

    for (const r of received) {
      expect(r.headers['x-shopify-topic']).toMatch(/^orders\//);
      expect(r.headers['x-shopify-shop-domain']).toBe('dtc-apparel.myshopify.com');
      expect(r.headers['x-shopify-api-version']).toBe('2024-10');
      expect(r.headers['x-shopify-webhook-id']).toMatch(/^[0-9a-f-]{36}$/i);
      expect(r.headers['x-shopify-order-id']).toBeTruthy();
      expect(r.headers['content-type']).toContain('application/json');
      expect(r.body).toMatchObject({ id: expect.any(Number), currency: 'USD' });
    }
  });

  it('reports failures when the endpoint returns 5xx', async () => {
    const failing = createServer((_req, res) => {
      res.statusCode = 500;
      res.end('nope');
    });
    await new Promise<void>((r) => failing.listen(0, '127.0.0.1', r));
    const port = (failing.address() as AddressInfo).port;
    const failingUrl = `http://127.0.0.1:${port}/webhooks`;

    const stats = await run(defaults({ url: failingUrl, burst: 5, topics: 'orders', concurrency: 2, seed: 11 }));
    expect(stats.failed).toBe(5);
    expect(stats.ok).toBe(0);

    await new Promise<void>((r) => failing.close(() => r()));
  });
});

describe('Topic typing remains exhaustive', () => {
  it('every emitted topic is one of the canonical Shopify topics', async () => {
    const sender = new CollectingSender();
    await run(defaults({ burst: 60, topics: 'orders,products,customers', updateRate: 0.5, cancelRate: 0.2, concurrency: 4, seed: 12 }), { sender });
    const allowed: Topic[] = [
      'orders/create',
      'orders/updated',
      'products/create',
      'products/update',
      'customers/create',
      'customers/update',
    ];
    for (const e of sender.events) expect(allowed).toContain(e.topic);
  });
});
