# Shopify Webhook Simulator

Sends realistic Shopify webhook payloads to whatever endpoint you point it at. No HMAC signing — focus on data shape, not auth.

## Quick start

```bash
pnpm install
pnpm start --url http://localhost:3000/webhooks
```

Default: 1 order event/sec, 30% updates of existing orders, 5% cancellations, single shop `dtc-apparel.myshopify.com`. Ctrl+C to stop.

## Common recipes

```bash
# Steady mixed traffic across all topics
pnpm start --rps 5 --topics orders,products,customers

# Burst test: 5,000 events as fast as possible with 100 concurrent connections
pnpm start --burst 5000 --concurrency 100

# Stress workload: massive inserts → updates → cancels
pnpm start --workload stress --inserts 10000 --updates 5000 --cancels 1000 --concurrency 100

# Realism torture test: duplicates + out-of-order delivery
pnpm start --rps 20 --duplicate-rate 0.05 --out-of-order

# Reconciliation: drop 10% of webhooks; the same orders are still queryable
# via a Shopify-shape REST API on :3001 — your system must reconcile.
pnpm start --rps 10 --duration 60 --drop-rate 0.1 --backfill-port 3001
# In another terminal:
curl -H "X-Shopify-Access-Token: any-token" \
  http://localhost:3001/admin/api/2024-10/orders.json?limit=50

# Multi-shop (shows your design's tenancy story)
pnpm start --shops shop-a.myshopify.com,shop-b.myshopify.com,shop-c.myshopify.com

# See payloads without sending anywhere
pnpm start --dry-run -n 3

# Deterministic data (good for snapshot testing)
pnpm start --seed 42 --burst 100
```

## Flags

| Flag | Default | What it does |
| --- | --- | --- |
| `-u, --url <url>` | `http://localhost:3000/webhooks` | Webhook endpoint. |
| `-r, --rps <n>` | `1` | Events per second in steady mode. `0` = no rate limit. |
| `-c, --concurrency <n>` | `10` | Max concurrent in-flight requests. |
| `-d, --duration <seconds>` | — | Stop after N seconds. |
| `-n, --total <n>` | — | Stop after N events. |
| `--burst <n>` | — | Send N events as fast as possible, ignoring `--rps`, then exit. |
| `--workload <mode>` | `steady` | `steady` or `stress`. |
| `--topics <list>` | `orders` | Any of `orders,products,customers`. |
| `--update-rate <n>` | `0.3` | Fraction of order events that mutate an existing order. |
| `--cancel-rate <n>` | `0.05` | Fraction of order events that cancel an existing order. |
| `--duplicate-rate <n>` | `0` | Probability of sending each event twice (Shopify does this). |
| `--drop-rate <n>` | `0` | Probability the webhook is silently dropped. The entity stays in the simulator's pool, so it remains visible via `--backfill-port`. Models real Shopify webhook unreliability. |
| `--out-of-order` | off | Randomize delivery order (Shopify does not guarantee order). |
| `--backfill-port <n>` | — | Expose Shopify-shape Admin REST API on this port. Routes: `GET /admin/api/2024-10/orders.json`, `…/orders/{id}.json`, `…/orders/count.json`. Requires `X-Shopify-Access-Token` (any non-empty value). |
| `--shops <list>` | `dtc-apparel.myshopify.com` | Comma-separated shop domains. |
| `--api-version <v>` | `2024-10` | `X-Shopify-API-Version` header value. |
| `--seed <n>` | — | Faker seed for deterministic data. |
| `--dry-run` | off | Log payloads to stdout instead of sending. |
| `-v, --verbose` | off | Log every request. |
| `--inserts <n>` | `10000` | (stress) orders/create count. |
| `--updates <n>` | `5000` | (stress) orders/updated count, drawn from prior creates. |
| `--cancels <n>` | `1000` | (stress) cancellation count. |

## Headers sent

Every request includes the headers a real Shopify webhook would send (minus the HMAC):

```
Content-Type: application/json
X-Shopify-Topic: orders/create
X-Shopify-Shop-Domain: dtc-apparel.myshopify.com
X-Shopify-API-Version: 2024-10
X-Shopify-Webhook-Id: 0190e7ab-…  (uuid v4 — unique per delivery, repeated only on duplicate sends)
X-Shopify-Triggered-At: 2026-05-08T13:42:51.001Z
X-Shopify-Order-Id: 821982911946154500   (orders/* topics only)
X-Shopify-Product-Id: 728213…            (products/* topics only)
X-Shopify-Customer-Id: 532915…           (customers/* topics only)
```

## Topics emitted

| Topic | When |
| --- | --- |
| `orders/create` | New order. |
| `orders/updated` | Lifecycle progression (pending → paid → fulfilled), tag/note edits, **and cancellations**. |
| `products/create` | New product (apparel, multiple color × size variants). |
| `products/update` | Inventory tick, occasional status flip. |
| `customers/create` | New customer. |
| `customers/update` | Marketing opt-in flip / tag changes. |

> Cancellations are delivered as `orders/updated` with `cancelled_at` set and `financial_status` flipped to `refunded`/`voided`. This matches Shopify's behavior — there's also a separate `orders/cancelled` topic, but most pipelines key off `cancelled_at` from updates.

## Backfill REST mock (`--backfill-port`)

When `--backfill-port` is set, the simulator also serves a tiny Shopify Admin API mock on that port, backed by the same in-memory pool used for webhook generation. This is the integration test for **reconciliation**: drop a fraction of webhooks with `--drop-rate` and the candidate's system has to recover them via REST.

```
GET /admin/api/{version}/orders.json?limit=&since_id=&status=&financial_status=&updated_at_min=&updated_at_max=
GET /admin/api/{version}/orders/{id}.json
GET /admin/api/{version}/orders/count.json
```

- All endpoints require `X-Shopify-Access-Token` header (any non-empty value passes).
- List endpoint paginates via `since_id` and emits a Shopify-style `Link: <…>; rel="next"` header.
- All filters are AND-combined.

## Stateful behavior

The simulator keeps a bounded in-memory pool of created entities (max 5,000 each). When generating an update or cancellation, it samples from this pool — so updates always reference orders/products/customers the system has actually seen. This produces realistic referential traffic, including the Shopify quirk where you'll see N updates for the same `id` over time.

## Output

Every 5 seconds the simulator prints a tick of stats (sent, ok, failed, by-topic counts). On exit, a final summary. Failures (non-2xx, network errors) are logged inline.

## Layout

```
simulator/
├── src/
│   ├── index.ts              # CLI shell
│   ├── runner.ts             # sender, dispatcher, scheduler, orchestrator
│   ├── backfill.ts           # Shopify-shape Admin REST mock
│   ├── state.ts              # bounded entity pool
│   └── factories/
│       ├── common.ts         # ids, addresses, apparel taxonomy
│       ├── order.ts          # order payload + lifecycle progression
│       ├── product.ts        # product payload (variants by color × size)
│       └── customer.ts       # customer payload
└── examples/                 # sample payloads (regenerate with `pnpm examples`)
```

## Tests

```bash
pnpm test          # one-shot
pnpm test:watch    # TDD loop
```

60 tests across factories, state, runner, and backfill. End-to-end coverage includes a real HTTP listener and verification that dropped webhooks remain recoverable via the REST mock.
