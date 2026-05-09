"""Tests for the webhook ingest building blocks.

These run against the live Postgres container (started by docker-compose).
Each test wraps its work in a transaction that is rolled back at teardown,
so tests are isolated and parallel-safe.
"""

import asyncio
import json
import os
from datetime import datetime, timedelta, timezone

import asyncpg
import pytest
import pytest_asyncio

from shopify_app.modules.ingest import process_webhook, record_raw_event, upsert_order
from shopify_app.modules.models import parse_order

CONCURRENCY_DSN = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5433/shopify",
)


def make_payload(
    *,
    order_id: int = 1001,
    updated_at: datetime,
    cancelled_at: datetime | None = None,
    financial_status: str = "pending",
    total_price: str = "100.00",
    line_items: list[dict] | None = None,
) -> dict:
    return {
        "id": order_id,
        "created_at": updated_at.isoformat(),
        "updated_at": updated_at.isoformat(),
        "cancelled_at": cancelled_at.isoformat() if cancelled_at else None,
        "cancel_reason": "fraud" if cancelled_at else None,
        "financial_status": financial_status,
        "fulfillment_status": None,
        "total_price": total_price,
        "line_items": line_items
        if line_items is not None
        else [
            {
                "id": 9001,
                "product_id": 1,
                "variant_id": 11,
                "title": "Tee",
                "sku": "TEE-BLK-M",
                "quantity": 1,
                "price": total_price,
            }
        ],
    }


@pytest.mark.asyncio
async def test_duplicate_webhook_id_inserts_once(conn):
    payload = make_payload(updated_at=datetime.now(timezone.utc))
    is_new_first = await record_raw_event(
        conn, "wh-1", "orders/create", "shop.myshopify.com", payload
    )
    is_new_second = await record_raw_event(
        conn, "wh-1", "orders/create", "shop.myshopify.com", payload
    )

    assert is_new_first is True
    assert is_new_second is False
    count = await conn.fetchval(
        "SELECT COUNT(*) FROM raw_events WHERE webhook_id = 'wh-1'"
    )
    assert count == 1


@pytest.mark.asyncio
async def test_out_of_order_does_not_overwrite_newer_state(conn):
    """Older event arriving after newer one must NOT overwrite state."""
    older = datetime.now(timezone.utc) - timedelta(seconds=10)
    newer = datetime.now(timezone.utc)

    # Newer event arrives first.
    p_newer = make_payload(
        order_id=2001, updated_at=newer, financial_status="paid", total_price="150.00"
    )
    await upsert_order(conn, parse_order(p_newer, "shop.myshopify.com"))

    # Older event arrives second — should NOT overwrite.
    p_older = make_payload(
        order_id=2001,
        updated_at=older,
        financial_status="pending",
        total_price="999.99",
    )
    await upsert_order(conn, parse_order(p_older, "shop.myshopify.com"))

    row = await conn.fetchrow(
        "SELECT financial_status, total_price, updated_at FROM orders WHERE order_id = 2001"
    )
    assert row["financial_status"] == "paid"
    assert str(row["total_price"]) == "150.00"
    assert row["updated_at"] == newer


@pytest.mark.asyncio
async def test_in_order_updates_apply(conn):
    older = datetime.now(timezone.utc) - timedelta(seconds=10)
    newer = datetime.now(timezone.utc)
    p1 = make_payload(order_id=2002, updated_at=older, financial_status="pending")
    p2 = make_payload(order_id=2002, updated_at=newer, financial_status="paid")

    await upsert_order(conn, parse_order(p1, "shop.myshopify.com"))
    await upsert_order(conn, parse_order(p2, "shop.myshopify.com"))

    status = await conn.fetchval(
        "SELECT financial_status FROM orders WHERE order_id = 2002"
    )
    assert status == "paid"


@pytest.mark.asyncio
async def test_cancellation_via_orders_updated_topic(conn):
    """Cancelled orders arrive on orders/updated, not orders/cancelled."""
    created = datetime.now(timezone.utc) - timedelta(seconds=10)
    cancelled = datetime.now(timezone.utc)

    initial = make_payload(order_id=3001, updated_at=created)
    await upsert_order(conn, parse_order(initial, "shop.myshopify.com"))

    cancel_payload = make_payload(
        order_id=3001,
        updated_at=cancelled,
        cancelled_at=cancelled,
        financial_status="refunded",
    )
    await upsert_order(conn, parse_order(cancel_payload, "shop.myshopify.com"))

    row = await conn.fetchrow(
        "SELECT cancelled_at, cancel_reason, financial_status FROM orders WHERE order_id = 3001"
    )
    assert row["cancelled_at"] is not None
    assert row["cancel_reason"] == "fraud"
    assert row["financial_status"] == "refunded"


@pytest.mark.asyncio
async def test_line_items_replaced_on_update(conn):
    older = datetime.now(timezone.utc) - timedelta(seconds=10)
    newer = datetime.now(timezone.utc)

    initial = make_payload(
        order_id=4001,
        updated_at=older,
        line_items=[
            {
                "id": 50001,
                "product_id": 1,
                "variant_id": 11,
                "title": "Old",
                "sku": "OLD-1",
                "quantity": 1,
                "price": "10.00",
            }
        ],
    )
    await upsert_order(conn, parse_order(initial, "shop.myshopify.com"))

    updated = make_payload(
        order_id=4001,
        updated_at=newer,
        line_items=[
            {
                "id": 50002,
                "product_id": 2,
                "variant_id": 22,
                "title": "New",
                "sku": "NEW-1",
                "quantity": 2,
                "price": "20.00",
            }
        ],
    )
    await upsert_order(conn, parse_order(updated, "shop.myshopify.com"))

    skus = [r["sku"] for r in await conn.fetch(
        "SELECT sku FROM order_items WHERE order_id = 4001"
    )]
    assert skus == ["NEW-1"]


@pytest.mark.asyncio
async def test_stale_update_does_not_drop_newer_line_items(conn):
    """If a stale event arrives after a newer one, newer line items survive."""
    older = datetime.now(timezone.utc) - timedelta(seconds=10)
    newer = datetime.now(timezone.utc)

    newer_payload = make_payload(
        order_id=4002,
        updated_at=newer,
        line_items=[
            {
                "id": 60001,
                "product_id": 1,
                "variant_id": 11,
                "title": "Keep",
                "sku": "KEEP-1",
                "quantity": 1,
                "price": "10.00",
            }
        ],
    )
    await upsert_order(conn, parse_order(newer_payload, "shop.myshopify.com"))

    older_payload = make_payload(
        order_id=4002,
        updated_at=older,
        line_items=[
            {
                "id": 60002,
                "product_id": 2,
                "variant_id": 22,
                "title": "Should not appear",
                "sku": "STALE-1",
                "quantity": 99,
                "price": "999.00",
            }
        ],
    )
    await upsert_order(conn, parse_order(older_payload, "shop.myshopify.com"))

    skus = [r["sku"] for r in await conn.fetch(
        "SELECT sku FROM order_items WHERE order_id = 4002"
    )]
    assert skus == ["KEEP-1"]


@pytest.mark.asyncio
async def test_record_raw_event_returns_true_on_first_insert(conn):
    payload = {"id": 7001}
    is_new = await record_raw_event(
        conn, "wh-fresh", "orders/create", "shop.myshopify.com", payload
    )
    assert is_new is True

    stored = await conn.fetchval(
        "SELECT payload FROM raw_events WHERE webhook_id = 'wh-fresh'"
    )
    assert json.loads(stored)["id"] == 7001


@pytest_asyncio.fixture
async def concurrent_pool():
    """Real pool for the concurrency test — process_webhook commits, can't roll back."""
    pool = await asyncpg.create_pool(dsn=CONCURRENCY_DSN, min_size=4, max_size=20)
    yield pool
    await pool.close()


@pytest.mark.asyncio
async def test_concurrent_duplicate_webhooks_insert_once(concurrent_pool):
    """20 parallel process_webhook calls with the same webhook_id.

    The PK on raw_events.webhook_id is the serialization point; only one
    INSERT may win. This proves the dedup is race-free at concurrency.
    """
    webhook_id = "concurrent-dedup-test-9999999"
    order_id = 9999999
    updated_at = datetime.now(timezone.utc)
    payload = make_payload(order_id=order_id, updated_at=updated_at)

    try:
        results = await asyncio.gather(
            *[
                process_webhook(
                    concurrent_pool,
                    webhook_id,
                    "orders/create",
                    "shop.myshopify.com",
                    payload,
                )
                for _ in range(20)
            ]
        )

        # Exactly one call should report "newly processed".
        assert sum(1 for r in results if r is True) == 1
        assert sum(1 for r in results if r is False) == 19

        async with concurrent_pool.acquire() as c:
            raw_count = await c.fetchval(
                "SELECT COUNT(*) FROM raw_events WHERE webhook_id = $1", webhook_id
            )
            order_count = await c.fetchval(
                "SELECT COUNT(*) FROM orders WHERE order_id = $1", order_id
            )
        assert raw_count == 1
        assert order_count == 1
    finally:
        async with concurrent_pool.acquire() as c:
            await c.execute("DELETE FROM order_items WHERE order_id = $1", order_id)
            await c.execute("DELETE FROM orders WHERE order_id = $1", order_id)
            await c.execute("DELETE FROM raw_events WHERE webhook_id = $1", webhook_id)
