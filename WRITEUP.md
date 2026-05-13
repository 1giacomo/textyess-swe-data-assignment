# Writeup

## Data model

Two layers, each with one job.

**`raw_events`** is an append-only audit log keyed by
`X-Shopify-Webhook-Id` (PK, JSONB payload). It is the deduplication boundary
and the replay store. If we ever change how we transform an order, we can
re-derive the materialized state from this table without re-receiving anything.

**`orders` + `order_items`** is the materialized current state, designed for
the dashboard. `orders.order_id` is the PK; `order_items` cascades on delete.
Both tables carry the columns Grafana actually queries: `total_price`,
`cancelled_at`, `financial_status`, `created_at`, `updated_at`, `sku`,
`quantity`. A `source` column distinguishes webhook-delivered rows from
rows recovered by the reconciliation job.

I considered going with the materialized layer alone — fewer rows, simpler
schema — but the JSONB raw layer is cheap, makes idempotency mechanical, and
gives me a usable trail when something is off in production. For an event-
driven system that is the right trade.

## Idempotency

Shopify retries every webhook until it gets a 2xx, with the same
`X-Shopify-Webhook-Id` each time. The Postgres primary key on `raw_events`
is the serialization point: at 100 concurrency, two duplicate deliveries
race at the `INSERT ... ON CONFLICT DO NOTHING RETURNING webhook_id`, and
only one wins. The loser sees no row in `RETURNING` and the rest of the
transaction is skipped. No application-level locking, no Redis, no queue —
just the database doing what it is good at.

## Out-of-order delivery

Webhooks arrive in arbitrary order. The materialized upsert is guarded by
`WHERE orders.updated_at < EXCLUDED.updated_at` on the `ON CONFLICT DO
UPDATE`. A stale event whose `updated_at` is older than what is already
stored is silently skipped. The line-items replace step is gated on the
same predicate (via `RETURNING`) so a stale parent never erases fresher
children.

Cancellations come on `orders/updated`, not `orders/cancelled` — the
simulator (and real Shopify) signals them by setting `cancelled_at` in the
payload. Detection is therefore data-driven, not topic-based. The dashboard
filters `WHERE cancelled_at IS NULL` so cancelled orders drop out of GMV.

## Reconciliation

`APScheduler` fires `reconcile_once` every 10s in-process (configurable via
`RECONCILE_INTERVAL_SECONDS`). 10s is short enough that the grading
scenario's 60s run sees several reconciliation cycles, and short enough
that the dashboard reflects recovered orders within seconds. It reads
`MAX(updated_at)` from `orders`, subtracts a 60s safety buffer, and queries
`/admin/api/2024-10/orders.json?updated_at_min=...&limit=250`. It follows
the `Link: rel="next"` header through every page on each tick, so no orders
are missed regardless of pool size. Each recovered order goes through the
same upsert as the webhook path; the `WHERE updated_at < EXCLUDED.updated_at`
clause means a slow REST response cannot clobber fresher webhook state.

The `updated_at_min` window keeps each tick bounded — we are not paginating
the entire pool every 30s — while the safety buffer absorbs clock skew and
poll-boundary edge cases.

## Trade-offs and what I would do next

**In-process scheduler.** APScheduler runs alongside FastAPI in the same
process. Operationally simpler for a take-home (one container, one log
stream), but if uvicorn dies, reconciliation dies too. In production I
would split it into a separate worker container.

**`init.sql` instead of Alembic.** This is greenfield — there is no
migration history yet — and `docker-entrypoint-initdb.d` is the simplest
single-command bring-up. The first real schema change is when I would add
Alembic.

**Async pool sized 10–20.** Tuned for the burst scenario (5,000 webhooks at
100 concurrency). Each webhook is a single transaction with at most three
statements (raw_events insert, orders upsert, items replace), so the pool
saturates briefly under burst and drains in seconds.

**Things I deliberately did not build.** Multi-tenancy (the `shop_domain`
column reserves the upgrade path), HMAC signature verification (not part of
the simulator contract), a dead-letter queue (would require a real failure
mode to design against), and observability beyond logs. Schema evolution
would land next: a versioned mapper between raw payload and materialized
columns, so a renamed Shopify field becomes a code change, not a deploy
break.
