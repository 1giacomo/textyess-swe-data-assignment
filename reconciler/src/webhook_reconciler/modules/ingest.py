import json
import logging
from typing import Literal

import asyncpg

from webhook_reconciler.modules.models import OrderRecord, parse_order

logger = logging.getLogger(__name__)

Source = Literal["webhook", "reconciliation"]


async def record_raw_event(
    conn: asyncpg.Connection,
    webhook_id: str,
    topic: str,
    shop_domain: str,
    payload: dict,
) -> bool:
    """Insert into raw_events. Returns True if newly inserted, False if duplicate.

    The webhook_id PK is the serialization point: at high concurrency, two
    requests with the same id race here and only one wins. The loser sees
    no row in RETURNING and skips the rest of the work.
    """
    row = await conn.fetchrow(
        """
        INSERT INTO raw_events (webhook_id, topic, shop_domain, payload)
        VALUES ($1, $2, $3, $4::jsonb)
        ON CONFLICT (webhook_id) DO NOTHING
        RETURNING webhook_id
        """,
        webhook_id,
        topic,
        shop_domain,
        json.dumps(payload),
    )
    return row is not None


async def upsert_order(
    conn: asyncpg.Connection, order: OrderRecord, source: Source = "webhook"
) -> None:
    """Upsert an order with latest-write semantics on out-of-order delivery.

    The ``WHERE orders.updated_at < EXCLUDED.updated_at`` clause is the only
    thing that prevents a stale event from clobbering newer state. Without it,
    out-of-order delivery silently corrupts the materialized view.
    """
    written = await conn.fetchrow(
        """
        INSERT INTO orders (
            order_id, shop_domain, financial_status, fulfillment_status,
            total_price, cancel_reason, cancelled_at, created_at, updated_at, source,
            shipping_latitude, shipping_longitude
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (order_id) DO UPDATE SET
            financial_status   = EXCLUDED.financial_status,
            fulfillment_status = EXCLUDED.fulfillment_status,
            total_price        = EXCLUDED.total_price,
            cancel_reason      = EXCLUDED.cancel_reason,
            cancelled_at       = EXCLUDED.cancelled_at,
            updated_at         = EXCLUDED.updated_at,
            source             = EXCLUDED.source,
            shipping_latitude  = EXCLUDED.shipping_latitude,
            shipping_longitude = EXCLUDED.shipping_longitude
        WHERE orders.updated_at < EXCLUDED.updated_at
        RETURNING order_id
        """,
        order.order_id,
        order.shop_domain,
        order.financial_status,
        order.fulfillment_status,
        order.total_price,
        order.cancel_reason,
        order.cancelled_at,
        order.created_at,
        order.updated_at,
        source,
        order.shipping_latitude,
        order.shipping_longitude,
    )

    # If the upsert was a no-op (stale event lost the WHERE check), the
    # existing line items are fresher than ours — leave them alone.
    if written is None:
        return

    await conn.execute("DELETE FROM order_items WHERE order_id = $1", order.order_id)
    if order.line_items:
        await conn.executemany(
            """
            INSERT INTO order_items
              (id, order_id, product_id, variant_id, title, sku, quantity, price)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            """,
            [
                (
                    li.id,
                    order.order_id,
                    li.product_id,
                    li.variant_id,
                    li.title,
                    li.sku,
                    li.quantity,
                    li.price,
                )
                for li in order.line_items
            ],
        )


async def process_webhook(
    pool: asyncpg.Pool,
    webhook_id: str,
    topic: str,
    shop_domain: str,
    payload: dict,
) -> bool:
    """Process one webhook end-to-end. Returns True on new event, False on duplicate."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            is_new = await record_raw_event(
                conn, webhook_id, topic, shop_domain, payload
            )
            if not is_new:
                return False

            if topic.startswith("orders/"):
                order = parse_order(payload, shop_domain)
                await upsert_order(conn, order, source="webhook")
            else:
                logger.debug("Ignoring non-order topic %s", topic)

            return True
