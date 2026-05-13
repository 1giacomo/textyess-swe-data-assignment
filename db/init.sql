-- Schema for Shopify webhook ingestion + reconciliation.
-- Applied automatically by the postgres image on first startup
-- (mounted into /docker-entrypoint-initdb.d/).

CREATE TABLE raw_events (
    webhook_id   TEXT PRIMARY KEY,
    topic        TEXT NOT NULL,
    shop_domain  TEXT NOT NULL,
    payload      JSONB NOT NULL,
    received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orders (
    order_id           BIGINT PRIMARY KEY,
    shop_domain        TEXT NOT NULL,
    financial_status   TEXT,
    fulfillment_status TEXT,
    total_price        NUMERIC(12,2),
    cancel_reason      TEXT,
    cancelled_at       TIMESTAMPTZ,
    created_at         TIMESTAMPTZ,
    updated_at         TIMESTAMPTZ NOT NULL,
    source             TEXT NOT NULL DEFAULT 'webhook',
    shipping_latitude  DOUBLE PRECISION,
    shipping_longitude DOUBLE PRECISION
);

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

CREATE INDEX idx_orders_updated_at ON orders (updated_at);
CREATE INDEX idx_orders_cancelled_at ON orders (cancelled_at);
CREATE INDEX idx_orders_created_at ON orders (created_at);
CREATE INDEX idx_order_items_order_id ON order_items (order_id);
CREATE INDEX idx_order_items_sku ON order_items (sku);
