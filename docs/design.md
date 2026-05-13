# Shopify Webhook Ingestion System — Design Spec

Date: 2026-05-09  
Stack: Python + FastAPI + PostgreSQL + Grafana  
Bring-up: `docker-compose up`

---

## Architecture

```
Shopify Simulator
      │ POST /webhooks (port 3000)
      ▼
┌──────────────────────────────────────────────────────┐
│  FastAPI app                                         │
│  POST /webhooks                                      │
│   1. INSERT raw_events ON CONFLICT DO NOTHING        │
│      RETURNING webhook_id  ← serialization point     │
│   2. if RETURNING empty → skip (duplicate)           │
│   3. else → upsert orders + delete/reinsert items    │
│      (all in one transaction)                        │
│  GET /health  → checks DB connectivity               │
│  APScheduler (every 30s) → reconciliation job        │
└──────────────────────────────────────────────────────┘
      │ asyncpg pool (min=10, max=20)
      ▼
┌──────────────────────────────────────────────────────┐
│  PostgreSQL                                          │
│  ├── raw_events  (webhook_id PK)                     │
│  ├── orders      (order_id PK)                       │
│  └── order_items (id PK, order_id FK)                │
└────────────────────┬─────────────────────────────────┘
                     │ read (Grafana PostgreSQL datasource)
                     ▼
              ┌─────────────┐
              │   Grafana   │ (port 3002)
              └─────────────┘
```

---

## Data Model

```sql
-- Deduplication layer. webhook_id PK is the serialization point for concurrent duplicates.
CREATE TABLE raw_events (
    webhook_id   TEXT PRIMARY KEY,
    topic        TEXT NOT NULL,
    shop_domain  TEXT NOT NULL,
    payload      JSONB NOT NULL,
    received_at  TIMESTAMPTZ DEFAULT now()
);

-- Materialized latest state per order.
CREATE TABLE orders (
    order_id           BIGINT PRIMARY KEY,
    shop_domain        TEXT NOT NULL,
    financial_status   TEXT,
    fulfillment_status TEXT,
    total_price        NUMERIC(12,2),
    cancel_reason      TEXT,
    cancelled_at       TIMESTAMPTZ,
    created_at         TIMESTAMPTZ,
    updated_at         TIMESTAMPTZ,
    source             TEXT DEFAULT 'webhook'
);

-- Line items deleted and reinserted per order update (avoids orphans).
CREATE TABLE order_items (
    id          BIGINT PRIMARY KEY,
    order_id    BIGINT NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    product_id  BIGINT,
    variant_id  BIGINT,
    title       TEXT,
    sku         TEXT,
    quantity    INT,
    price       NUMERIC(12,2)
);

CREATE INDEX ON orders (updated_at);
CREATE INDEX ON orders (cancelled_at);
CREATE INDEX ON order_items (order_id);
CREATE INDEX ON order_items (sku);
```

---

## Webhook Ingest Logic

Single transaction per webhook — no multi-round-trip on the hot path.

```python
async with pool.acquire() as conn:
    async with conn.transaction():
        # Step 1 — deduplication (PK constraint serializes concurrent duplicates)
        result = await conn.fetchrow("""
            INSERT INTO raw_events (webhook_id, topic, shop_domain, payload)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (webhook_id) DO NOTHING
            RETURNING webhook_id
        """, webhook_id, topic, shop_domain, payload_json)

        if not result:
            return 200  # duplicate — nothing to do

        # Step 2 — upsert order with latest-write guard
        await conn.execute("""
            INSERT INTO orders (
                order_id, shop_domain, financial_status, fulfillment_status,
                total_price, cancel_reason, cancelled_at, created_at, updated_at, source
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            ON CONFLICT (order_id) DO UPDATE SET
                financial_status   = EXCLUDED.financial_status,
                fulfillment_status = EXCLUDED.fulfillment_status,
                total_price        = EXCLUDED.total_price,
                cancel_reason      = EXCLUDED.cancel_reason,
                cancelled_at       = EXCLUDED.cancelled_at,
                updated_at         = EXCLUDED.updated_at,
                source             = EXCLUDED.source
            WHERE orders.updated_at < EXCLUDED.updated_at
        """,
            order_id, shop_domain, financial_status, fulfillment_status,
            total_price, cancel_reason, cancelled_at, created_at, updated_at, source
        )

        # Step 3 — line items: delete then reinsert atomically
        await conn.execute("DELETE FROM order_items WHERE order_id = $1", order_id)
        await conn.executemany("INSERT INTO order_items VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", items)
```

**Cancellation detection:** inspect `payload["cancelled_at"] is not None`. Topic is always
`orders/updated` — never rely on the topic string alone.

**asyncpg pool:** `min_size=10, max_size=20` to survive 100-concurrency burst.

---

## Reconciliation Job

Runs every 30s inside FastAPI via APScheduler (`AsyncIOScheduler`).

```
1. SELECT MAX(updated_at) FROM orders  →  last_seen
2. GET /admin/api/2024-10/orders.json
       ?updated_at_min=(last_seen - 60s)
       &limit=250&since_id=0
       Header: X-Shopify-Access-Token: any-non-empty-value
3. Follow Link: rel="next" until exhausted (full pagination per tick)
4. For each order returned:
       upsert into orders + delete/reinsert order_items
       (same ON CONFLICT logic as webhook path)
5. Log count of recovered orders
```

The 60s buffer on `updated_at_min` guards against clock skew and poll boundary edge cases.
Full pagination per tick ensures no orders are missed regardless of pool size.

---

## Project Structure

```
/
├── app/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py            # FastAPI app, lifespan, routes
│   ├── db.py              # asyncpg pool setup
│   ├── ingest.py          # webhook handler logic
│   ├── reconcile.py       # reconciliation job
│   └── models.py          # Pydantic models for order payload
├── db/
│   └── init.sql           # schema — auto-applied on first postgres start
├── grafana/
│   └── provisioning/
│       ├── datasources/   # postgres datasource yaml
│       └── dashboards/    # dashboard JSON + provider yaml
├── docker-compose.yml
└── README.md
```

---

## Docker Compose

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: shopify
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    volumes:
      - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 10

  app:
    build: ./app
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/shopify
      BACKFILL_URL: http://host.docker.internal:3001
      BACKFILL_TOKEN: any-token
    depends_on:
      postgres:
        condition: service_healthy

  grafana:
    image: grafana/grafana:11.0.0
    ports:
      - "3002:3000"
    environment:
      GF_SECURITY_ADMIN_PASSWORD: admin
      GF_AUTH_ANONYMOUS_ENABLED: "true"
    volumes:
      - ./grafana/provisioning:/etc/grafana/provisioning
      - grafana_data:/var/lib/grafana
    depends_on:
      - postgres

volumes:
  pgdata:
  grafana_data:
```

---

## Grafana Dashboard

4 panels, all reading from PostgreSQL directly:

| Panel | Type | Core query |
|-------|------|-----------|
| GMV | Stat | `SELECT SUM(total_price) FROM orders WHERE cancelled_at IS NULL` |
| Orders over time | Time series | `SELECT date_trunc('minute', created_at), COUNT(*) FROM orders GROUP BY 1 ORDER BY 1` |
| Cancellation rate | Gauge | `SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE cancelled_at IS NOT NULL) / NULLIF(COUNT(*),0), 1) FROM orders` |
| Top SKUs | Bar chart | `SELECT sku, SUM(quantity) FROM order_items JOIN orders USING(order_id) WHERE orders.cancelled_at IS NULL GROUP BY sku ORDER BY 2 DESC LIMIT 10` |

Auto-refresh: 5s interval.

---

## Key Correctness Invariants

| Risk | Mitigation |
|------|-----------|
| Duplicate webhooks | `raw_events` PK + `RETURNING` check; skip if already seen |
| Out-of-order delivery | `WHERE orders.updated_at < EXCLUDED.updated_at` in upsert |
| Concurrent duplicate race | Postgres PK constraint serializes — only one INSERT wins |
| Cancellation misread | Detect via `cancelled_at != NULL` in payload, not topic |
| Orphaned line items | Delete + reinsert `order_items` in same transaction |
| Dropped webhooks | Reconciliation job with `updated_at_min` + full pagination |
| DB not ready on start | `depends_on: condition: service_healthy` |

---

## What is NOT built (deliberate scope cuts)

- Multi-tenancy (single shop assumed; `shop_domain` column preserves upgrade path)
- Dead-letter queue for failed webhook processing
- Alembic migrations (init.sql is sufficient for single-command bring-up)
- HMAC signature verification (not required by simulator)
- Metrics on reconciliation lag (worth noting in WRITEUP.md)
