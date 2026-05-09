# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Assignment overview

This is a SWE-Data home assignment: build a system that ingests Shopify webhook events, reconciles them against a backfill REST API, and powers a live merchant dashboard. The `simulator/` directory is provided infrastructure (not to be modified). The candidate builds everything else.

Deliverables: working system + `WRITEUP.md` (~1 page reasoning on data modeling, idempotency, reconciliation strategy, and trade-offs).

## Simulator commands

```bash
cd simulator
pnpm install
pnpm test              # run 60 tests (vitest, one-shot)
pnpm test:watch        # TDD loop
pnpm typecheck         # tsc --noEmit
```

Running the simulator (from `simulator/`):

```bash
# Default steady traffic (1 rps, orders only)
pnpm start --url http://localhost:3000/webhooks

# Scenario 1: retries + out-of-order
pnpm simulate --rps 10 --duration 120 --duplicate-rate 0.1 --out-of-order --update-rate 0.3 --cancel-rate 0.05

# Scenario 2: burst
pnpm simulate --burst 5000 --concurrency 100

# Scenario 3: stress
pnpm simulate --workload stress --inserts 10000 --updates 5000 --cancels 1000 --concurrency 100

# Scenario 4: reconciliation (10% dropped, REST backfill on :3001)
pnpm simulate --rps 10 --duration 60 --drop-rate 0.1 --backfill-port 3001

# Dry-run (no HTTP, logs payloads)
pnpm start --dry-run -n 3
```

Node 20+ required (see `.nvmrc`). Uses `pnpm@9.12.0`.

## Simulator architecture

**`runner.ts`** — core orchestration. Three job generators feed `runWithConcurrency`:

- `steadyJobs`: rate-limited stream, respects `--rps`, `--duration`, `--total`, abortable via signal
- `burstJobs`: fires N events as fast as possible
- `stressJobs`: sequential phases — all inserts first, then updates drawn from the pool, then cancels

`runWithConcurrency` manages a shared queue with N worker coroutines. Drop and duplicate logic sits here: dropped jobs increment `stats.dropped` and are never queued; duplicates push the same `Job` object twice.

Out-of-order delivery is implemented by `queue.splice(random_idx, 1)` instead of FIFO dequeue.

**`state.ts`** — `EntityPool<T>` is a bounded `Map<id, Tracked<T>>` (default max 5,000 per entity type). When full, the oldest entry (first inserted) is evicted. `random()` picks a uniform random entry in O(n) via iteration. `all()` returns entries sorted by `id` ascending — used by the backfill server for deterministic pagination.

**`backfill.ts`** — Node `http.createServer` mock of the Shopify Admin REST API. Reads live from the same `Pools` instance the runner mutates. Supports `orders.json` (filtered, paginated via `since_id`), `orders/{id}.json`, `orders/count.json`. Requires `X-Shopify-Access-Token` header (any non-empty value). Emits Shopify-style `Link: rel="next"` header when more pages exist.

**Cancellations** are delivered as `orders/updated` with `cancelled_at` set and `financial_status` → `refunded`/`voided`. The entity is removed from the pool after cancellation so it won't be sampled again.

## Webhook shape

Every POST includes these headers:

- `X-Shopify-Topic` — e.g. `orders/create`, `orders/updated`
- `X-Shopify-Shop-Domain` — defaults to `dtc-apparel.myshopify.com`
- `X-Shopify-Webhook-Id` — UUID v4, same value on duplicate deliveries
- `X-Shopify-Order-Id` — set for `orders/*` topics

Idempotency key for deduplication: `X-Shopify-Webhook-Id`. Order identity: `id` field in payload (also in `X-Shopify-Order-Id`). Latest-write semantics: use `updated_at` to apply updates in correct order regardless of delivery order.

## Backfill REST API (reconciliation)

```
GET /admin/api/2024-10/orders.json?limit=&since_id=&status=&financial_status=&updated_at_min=&updated_at_max=
GET /admin/api/2024-10/orders/{id}.json
GET /admin/api/2024-10/orders/count.json
```

Paginate via `since_id` (follow `Link` header or manually increment). Filters are AND-combined. The candidate's reconciliation job should detect gaps between webhook-received order IDs and REST API state, then back-fill missing orders.
