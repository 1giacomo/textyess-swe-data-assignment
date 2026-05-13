"""Tests for the reconciliation job.

We use httpx.MockTransport to simulate the Shopify backfill REST API,
so these tests run with no live network dependency. Each test gets a
fresh pool for isolation.
"""

import json
import os
from datetime import datetime, timedelta, timezone

import asyncpg
import httpx
import pytest_asyncio

from webhook_reconciler.modules.reconcile import reconcile_once

TEST_DSN = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5433/shopify",
)


def _order(order_id: int, *, updated_at: datetime, total_price: str = "50.00") -> dict:
    return {
        "id": order_id,
        "created_at": updated_at.isoformat(),
        "updated_at": updated_at.isoformat(),
        "cancelled_at": None,
        "cancel_reason": None,
        "financial_status": "paid",
        "fulfillment_status": None,
        "total_price": total_price,
        "line_items": [
            {
                "id": 800000 + order_id,
                "product_id": 1,
                "variant_id": 11,
                "title": "X",
                "sku": "SKU-X",
                "quantity": 1,
                "price": total_price,
            }
        ],
    }


def _make_paginated_transport(pages: list[dict]):
    """Build a MockTransport that walks through the supplied pages.

    Each page dict can carry an optional ``next`` URL — when present it is
    emitted as a Link rel="next" header so the client follows it.
    """
    call_count = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        idx = call_count["n"]
        if idx >= len(pages):
            return httpx.Response(200, json={"orders": []})
        page = pages[idx]
        call_count["n"] += 1
        headers = {}
        if "next_url" in page:
            headers["Link"] = f'<{page["next_url"]}>; rel="next"'
        return httpx.Response(200, json={"orders": page["orders"]}, headers=headers)

    return httpx.MockTransport(handler), call_count


@pytest_asyncio.fixture
async def isolated_pool():
    """Throw-away pool — these tests insert data outside a rolled-back tx."""
    pool = await asyncpg.create_pool(dsn=TEST_DSN, min_size=1, max_size=2)
    yield pool
    await pool.close()


async def _truncate(pool):
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM order_items WHERE order_id >= 9000000")
        await conn.execute("DELETE FROM orders WHERE order_id >= 9000000")
        await conn.execute("DELETE FROM raw_events WHERE webhook_id LIKE 'rec-test-%'")


async def test_reconcile_inserts_missing_order(isolated_pool):
    await _truncate(isolated_pool)
    order = _order(9000001, updated_at=datetime.now(timezone.utc))

    transport, calls = _make_paginated_transport([{"orders": [order]}])
    async with httpx.AsyncClient(transport=transport) as client:
        n = await reconcile_once(isolated_pool, client, base_url="http://mock")

    assert n == 1
    assert calls["n"] == 1
    async with isolated_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT order_id, source FROM orders WHERE order_id = 9000001"
        )
    assert row["order_id"] == 9000001
    assert row["source"] == "reconciliation"
    await _truncate(isolated_pool)


async def test_reconcile_follows_link_next_across_pages(isolated_pool):
    await _truncate(isolated_pool)
    now = datetime.now(timezone.utc)
    page1 = {
        "orders": [_order(9000010, updated_at=now), _order(9000011, updated_at=now)],
        "next_url": "http://mock/admin/api/2024-10/orders.json?since_id=9000011",
    }
    page2 = {"orders": [_order(9000012, updated_at=now)]}

    transport, calls = _make_paginated_transport([page1, page2])
    async with httpx.AsyncClient(transport=transport) as client:
        n = await reconcile_once(isolated_pool, client, base_url="http://mock")

    assert n == 3
    assert calls["n"] == 2
    async with isolated_pool.acquire() as conn:
        ids = [
            r["order_id"]
            for r in await conn.fetch(
                "SELECT order_id FROM orders WHERE order_id BETWEEN 9000010 AND 9000012 ORDER BY order_id"
            )
        ]
    assert ids == [9000010, 9000011, 9000012]
    await _truncate(isolated_pool)


async def test_reconcile_does_not_overwrite_newer_state(isolated_pool):
    """If DB already has a newer updated_at, reconciliation must NOT clobber it."""
    await _truncate(isolated_pool)
    older = datetime.now(timezone.utc) - timedelta(seconds=120)
    newer = datetime.now(timezone.utc)

    # Seed DB with newer state directly.
    async with isolated_pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO orders (order_id, shop_domain, financial_status, total_price, updated_at, source)
            VALUES (9000020, 'shop.myshopify.com', 'paid', 200.00, $1, 'webhook')
            """,
            newer,
        )

    # Reconciliation returns the OLDER copy.
    older_payload = _order(9000020, updated_at=older, total_price="50.00")
    transport, _ = _make_paginated_transport([{"orders": [older_payload]}])
    async with httpx.AsyncClient(transport=transport) as client:
        await reconcile_once(isolated_pool, client, base_url="http://mock")

    async with isolated_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT total_price, source, updated_at FROM orders WHERE order_id = 9000020"
        )
    # Newer state preserved — WHERE updated_at < EXCLUDED.updated_at saved us.
    assert str(row["total_price"]) == "200.00"
    assert row["source"] == "webhook"
    assert row["updated_at"] == newer
    await _truncate(isolated_pool)
