import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Pools } from './runner.js';

// Shopify-shape REST mock so candidates can build a reconciliation job that
// recovers events the webhook dropped. Mirrors the public Admin API just
// enough to be useful: orders.json (paginated), orders/{id}.json, orders/count.json.

interface OrdersQuery {
  limit: number;
  sinceId?: number;
  status?: 'any' | 'open' | 'closed' | 'cancelled';
  financialStatus?: string;
  updatedAtMin?: string;
  updatedAtMax?: string;
}

function parseQuery(url: URL): OrdersQuery {
  const limit = Math.min(250, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10) || 50));
  const sinceIdRaw = url.searchParams.get('since_id');
  const sinceId = sinceIdRaw ? parseInt(sinceIdRaw, 10) : undefined;
  const status = (url.searchParams.get('status') as OrdersQuery['status']) ?? 'any';
  const financialStatus = url.searchParams.get('financial_status') ?? undefined;
  const updatedAtMin = url.searchParams.get('updated_at_min') ?? undefined;
  const updatedAtMax = url.searchParams.get('updated_at_max') ?? undefined;
  return { limit, sinceId, status, financialStatus, updatedAtMin, updatedAtMax };
}

function filterOrders(pools: Pools, q: OrdersQuery) {
  let orders = pools.orders.all().map((t) => t.payload);

  if (q.status === 'open') orders = orders.filter((o) => o.cancelled_at === null && o.closed_at === null);
  else if (q.status === 'closed') orders = orders.filter((o) => o.closed_at !== null);
  else if (q.status === 'cancelled') orders = orders.filter((o) => o.cancelled_at !== null);

  if (q.financialStatus) orders = orders.filter((o) => o.financial_status === q.financialStatus);
  if (q.updatedAtMin) orders = orders.filter((o) => o.updated_at >= q.updatedAtMin!);
  if (q.updatedAtMax) orders = orders.filter((o) => o.updated_at <= q.updatedAtMax!);
  if (q.sinceId !== undefined) orders = orders.filter((o) => o.id > q.sinceId!);

  return orders;
}

export interface BackfillServer {
  server: Server;
  port: number;
  url: string;
  close(): Promise<void>;
}

export interface BackfillOptions {
  port?: number;
  apiVersion?: string;
  requireAuth?: boolean;
}

export function startBackfillServer(pools: Pools, opts: BackfillOptions = {}): Promise<BackfillServer> {
  const apiVersion = opts.apiVersion ?? '2024-10';
  const requireAuth = opts.requireAuth ?? true;

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost`);

      if (requireAuth && !req.headers['x-shopify-access-token']) {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ errors: '[API] Invalid API key or access token (unrecognized login or wrong password)' }));
        return;
      }

      const ordersListRe = new RegExp(`^/admin/api/${apiVersion}/orders\\.json$`);
      const ordersCountRe = new RegExp(`^/admin/api/${apiVersion}/orders/count\\.json$`);
      const ordersByIdRe = new RegExp(`^/admin/api/${apiVersion}/orders/(\\d+)\\.json$`);

      if (req.method === 'GET' && ordersListRe.test(url.pathname)) {
        const q = parseQuery(url);
        const filtered = filterOrders(pools, q);
        const page = filtered.slice(0, q.limit);
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };

        // Shopify uses Link headers for cursor-style pagination. We mimic the shape;
        // candidates can either follow Link or just paginate via since_id.
        if (filtered.length > q.limit) {
          const lastId = page.at(-1)!.id;
          headers['Link'] = `<${url.origin}/admin/api/${apiVersion}/orders.json?limit=${q.limit}&since_id=${lastId}>; rel="next"`;
        }
        res.writeHead(200, headers);
        res.end(JSON.stringify({ orders: page }));
        return;
      }

      if (req.method === 'GET' && ordersCountRe.test(url.pathname)) {
        const q = parseQuery(url);
        const count = filterOrders(pools, q).length;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ count }));
        return;
      }

      const byIdMatch = ordersByIdRe.exec(url.pathname);
      if (req.method === 'GET' && byIdMatch) {
        const id = parseInt(byIdMatch[1]!, 10);
        const tracked = pools.orders.get(id);
        if (!tracked) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ errors: 'Not Found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ order: tracked.payload }));
        return;
      }

      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ errors: 'Not Found' }));
    });

    server.on('error', reject);
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      const url = `http://127.0.0.1:${port}`;
      resolve({
        server,
        port,
        url,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
