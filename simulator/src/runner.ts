import { faker } from '@faker-js/faker';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { EntityPool } from './state.js';
import { newCustomer, updateCustomer, type ShopifyCustomer } from './factories/customer.js';
import { newProduct, updateProduct, type ShopifyProduct } from './factories/product.js';
import { cancelOrder, newOrder, progressOrder, type ShopifyOrder } from './factories/order.js';

export type Topic =
  | `orders/${'create' | 'updated' | 'cancelled'}`
  | `products/${'create' | 'update' | 'delete'}`
  | `customers/${'create' | 'update' | 'delete'}`;

export interface RunnerOptions {
  url: string;
  rps: number;
  concurrency: number;
  duration?: number;
  total?: number;
  burst?: number;
  workload: 'steady' | 'stress';
  topics: string;
  updateRate: number;
  cancelRate: number;
  duplicateRate: number;
  dropRate: number;
  outOfOrder: boolean;
  shops: string;
  apiVersion: string;
  seed?: number;
  dryRun: boolean;
  verbose: boolean;
  inserts: number;
  updates: number;
  cancels: number;
  backfillPort?: number;
}

export interface Stats {
  sent: number;
  ok: number;
  failed: number;
  dropped: number;
  byTopic: Map<Topic, number>;
  start: number;
}

export function newStats(): Stats {
  return { sent: 0, ok: 0, failed: 0, dropped: 0, byTopic: new Map(), start: Date.now() };
}

export function bump(stats: Stats, topic: Topic, ok: boolean) {
  stats.sent++;
  if (ok) stats.ok++;
  else stats.failed++;
  stats.byTopic.set(topic, (stats.byTopic.get(topic) ?? 0) + 1);
}

export interface Sender {
  send(topic: Topic, payload: object, shop: string, resourceId: number): Promise<boolean>;
}

export function buildHeaders(topic: Topic, shop: string, resourceId: number, apiVersion: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Shopify-Topic': topic,
    'X-Shopify-Shop-Domain': shop,
    'X-Shopify-API-Version': apiVersion,
    'X-Shopify-Webhook-Id': randomUUID(),
    'X-Shopify-Triggered-At': new Date().toISOString(),
  };
  if (topic.startsWith('orders/')) headers['X-Shopify-Order-Id'] = String(resourceId);
  if (topic.startsWith('products/')) headers['X-Shopify-Product-Id'] = String(resourceId);
  if (topic.startsWith('customers/')) headers['X-Shopify-Customer-Id'] = String(resourceId);
  return headers;
}

export class HttpSender implements Sender {
  constructor(
    private readonly url: string,
    private readonly apiVersion: string,
    private readonly verbose: boolean,
  ) {}

  async send(topic: Topic, payload: object, shop: string, resourceId: number): Promise<boolean> {
    const headers = buildHeaders(topic, shop, resourceId, this.apiVersion);
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      if (this.verbose) console.log(`POST ${topic} id=${resourceId} -> ${res.status}`);
      if (!res.ok) {
        if (!this.verbose) console.warn(`POST ${topic} id=${resourceId} -> ${res.status}`);
        return false;
      }
      return true;
    } catch (err) {
      console.warn(`POST ${topic} id=${resourceId} -> ERROR ${(err as Error).message}`);
      return false;
    }
  }
}

export class DryRunSender implements Sender {
  async send(topic: Topic, payload: object, shop: string, resourceId: number): Promise<boolean> {
    console.log(JSON.stringify({ topic, shop, resourceId, payload }, null, 2));
    return true;
  }
}

export class CollectingSender implements Sender {
  readonly events: Array<{ topic: Topic; payload: object; shop: string; resourceId: number }> = [];
  async send(topic: Topic, payload: object, shop: string, resourceId: number): Promise<boolean> {
    this.events.push({ topic, payload, shop, resourceId });
    return true;
  }
}

export interface Job {
  topic: Topic;
  shop: string;
  payload: object;
  resourceId: number;
}

export interface Pools {
  orders: EntityPool<ShopifyOrder>;
  products: EntityPool<ShopifyProduct>;
  customers: EntityPool<ShopifyCustomer>;
}

export function newPools(): Pools {
  return {
    orders: new EntityPool<ShopifyOrder>(),
    products: new EntityPool<ShopifyProduct>(),
    customers: new EntityPool<ShopifyCustomer>(),
  };
}

export function pickShop(shops: string[]): string {
  return shops[Math.floor(Math.random() * shops.length)] ?? 'dtc-apparel.myshopify.com';
}

export type TopicGroup = 'orders' | 'products' | 'customers';

export function pickTopicGroup(topics: string[]): TopicGroup {
  const t = topics[Math.floor(Math.random() * topics.length)];
  if (t === 'products') return 'products';
  if (t === 'customers') return 'customers';
  return 'orders';
}

export function nextJob(group: TopicGroup, shop: string, pools: Pools, opts: Pick<RunnerOptions, 'updateRate' | 'cancelRate'>): Job | null {
  const r = Math.random();
  if (group === 'orders') {
    if (r < opts.cancelRate) {
      const existing = pools.orders.random();
      if (existing) {
        const cancelled = cancelOrder(existing.payload);
        pools.orders.remove(cancelled.id);
        return { topic: 'orders/updated', shop: existing.shop, payload: cancelled, resourceId: cancelled.id };
      }
    }
    if (r < opts.cancelRate + opts.updateRate) {
      const existing = pools.orders.random();
      if (existing) {
        const updated = progressOrder(existing.payload);
        pools.orders.update(updated);
        return { topic: 'orders/updated', shop: existing.shop, payload: updated, resourceId: updated.id };
      }
    }
    const order = newOrder({ shopName: shop.replace('.myshopify.com', '') });
    pools.orders.add(shop, order);
    return { topic: 'orders/create', shop, payload: order, resourceId: order.id };
  }

  if (group === 'products') {
    if (r < 0.7) {
      const existing = pools.products.random();
      if (existing) {
        const updated = updateProduct(existing.payload);
        pools.products.update(updated);
        return { topic: 'products/update', shop: existing.shop, payload: updated, resourceId: updated.id };
      }
    }
    const product = newProduct();
    pools.products.add(shop, product);
    return { topic: 'products/create', shop, payload: product, resourceId: product.id };
  }

  if (r < 0.3) {
    const existing = pools.customers.random();
    if (existing) {
      const updated = updateCustomer(existing.payload);
      pools.customers.update(updated);
      return { topic: 'customers/update', shop: existing.shop, payload: updated, resourceId: updated.id };
    }
  }
  const customer = newCustomer();
  pools.customers.add(shop, customer);
  return { topic: 'customers/create', shop, payload: customer, resourceId: customer.id };
}

export interface DeliveryOptions {
  dupRate: number;
  outOfOrder: boolean;
  dropRate: number;
}

export async function runWithConcurrency(
  jobs: AsyncIterable<Job>,
  concurrency: number,
  sender: Sender,
  stats: Stats,
  delivery: DeliveryOptions,
): Promise<void> {
  const queue: Job[] = [];
  let producerDone = false;

  const producer = (async () => {
    for await (const job of jobs) {
      // Silently drop the webhook delivery (entity remains in the pool, so it
      // is still visible via the backfill REST endpoint). Models real Shopify
      // webhook unreliability — candidates must reconcile via the Admin API.
      if (delivery.dropRate > 0 && Math.random() < delivery.dropRate) {
        stats.dropped++;
        continue;
      }
      queue.push(job);
      if (delivery.dupRate > 0 && Math.random() < delivery.dupRate) queue.push(job);
    }
    producerDone = true;
  })();

  async function worker() {
    while (!producerDone || queue.length > 0) {
      if (queue.length === 0) {
        await sleep(5);
        continue;
      }
      const idx = delivery.outOfOrder ? Math.floor(Math.random() * queue.length) : 0;
      const job = queue.splice(idx, 1)[0];
      if (!job) continue;
      const ok = await sender.send(job.topic, job.payload, job.shop, job.resourceId);
      bump(stats, job.topic, ok);
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all([producer, ...workers]);
}

export async function* steadyJobs(opts: RunnerOptions, pools: Pools, signal: AbortSignal): AsyncGenerator<Job> {
  const startedAt = Date.now();
  let sent = 0;
  const intervalMs = opts.rps > 0 ? 1000 / opts.rps : 0;
  let nextAt = Date.now();
  const topics = opts.topics.split(',').map((s) => s.trim()).filter(Boolean);
  const shops = opts.shops.split(',').map((s) => s.trim()).filter(Boolean);

  while (!signal.aborted) {
    if (opts.duration && (Date.now() - startedAt) / 1000 >= opts.duration) return;
    if (opts.total && sent >= opts.total) return;

    if (intervalMs > 0) {
      const delay = nextAt - Date.now();
      if (delay > 0) await sleep(delay);
      nextAt += intervalMs;
    }

    const shop = pickShop(shops);
    const group = pickTopicGroup(topics);
    const job = nextJob(group, shop, pools, opts);
    if (job) {
      sent++;
      yield job;
    }
  }
}

export async function* burstJobs(count: number, opts: RunnerOptions, pools: Pools): AsyncGenerator<Job> {
  const shops = opts.shops.split(',').map((s) => s.trim()).filter(Boolean);
  const topics = opts.topics.split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < count; i++) {
    const shop = pickShop(shops);
    const group = pickTopicGroup(topics);
    const job = nextJob(group, shop, pools, opts);
    if (job) yield job;
  }
}

export async function* stressJobs(opts: RunnerOptions, pools: Pools): AsyncGenerator<Job> {
  const shops = opts.shops.split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < opts.inserts; i++) {
    const shop = pickShop(shops);
    const order = newOrder({ shopName: shop.replace('.myshopify.com', '') });
    pools.orders.add(shop, order);
    yield { topic: 'orders/create', shop, payload: order, resourceId: order.id };
  }
  for (let i = 0; i < opts.updates; i++) {
    const existing = pools.orders.random();
    if (!existing) break;
    const updated = progressOrder(existing.payload);
    pools.orders.update(updated);
    yield { topic: 'orders/updated', shop: existing.shop, payload: updated, resourceId: updated.id };
  }
  for (let i = 0; i < opts.cancels; i++) {
    const existing = pools.orders.random();
    if (!existing) break;
    const cancelled = cancelOrder(existing.payload);
    pools.orders.remove(cancelled.id);
    yield { topic: 'orders/updated', shop: existing.shop, payload: cancelled, resourceId: cancelled.id };
  }
}

export interface RunHooks {
  signal?: AbortSignal;
  onTick?: (stats: Stats) => void;
  tickIntervalMs?: number;
  sender?: Sender;
  onPhase?: (phase: string) => void;
}

export async function run(opts: RunnerOptions, hooks: RunHooks = {}): Promise<Stats> {
  if (opts.seed !== undefined) faker.seed(opts.seed);

  const sender: Sender =
    hooks.sender ??
    (opts.dryRun ? new DryRunSender() : new HttpSender(opts.url, opts.apiVersion, opts.verbose));
  const pools = newPools();
  const stats = newStats();

  const ticker = hooks.onTick ? setInterval(() => hooks.onTick!(stats), hooks.tickIntervalMs ?? 5_000) : null;
  ticker?.unref();

  const delivery: DeliveryOptions = {
    dupRate: opts.duplicateRate,
    outOfOrder: opts.outOfOrder,
    dropRate: opts.dropRate,
  };

  let backfill: { close(): Promise<void> } | undefined;
  if (opts.backfillPort) {
    const { startBackfillServer } = await import('./backfill.js');
    const srv = await startBackfillServer(pools, { port: opts.backfillPort });
    backfill = { close: srv.close };
    hooks.onPhase?.(`backfill listening at ${srv.url}/admin/api/${opts.apiVersion}/orders.json`);
  }

  try {
    if (opts.burst) {
      hooks.onPhase?.('burst');
      await runWithConcurrency(burstJobs(opts.burst, opts, pools), opts.concurrency, sender, stats, delivery);
    } else if (opts.workload === 'stress') {
      hooks.onPhase?.('stress');
      await runWithConcurrency(stressJobs(opts, pools), opts.concurrency, sender, stats, delivery);
    } else {
      hooks.onPhase?.('steady');
      const signal = hooks.signal ?? new AbortController().signal;
      await runWithConcurrency(steadyJobs(opts, pools, signal), opts.concurrency, sender, stats, delivery);
    }
  } finally {
    if (ticker) clearInterval(ticker);
    if (backfill) await backfill.close();
  }

  return stats;
}
