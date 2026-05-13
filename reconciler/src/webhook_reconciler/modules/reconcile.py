"""Reconciliation job — recovers orders that the webhook deliveries missed.

Shopify retries webhooks but does not guarantee delivery. The simulator drops
a configurable fraction silently. The dropped orders still exist on the Admin
REST API, so we periodically poll it, follow the Link rel="next" cursor across
*all* pages, and upsert anything we don't already have.

The query is bounded by ``updated_at_min = (last_seen - safety_buffer)`` so
each tick scans only the recent window, not the whole pool.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Iterable

import asyncpg
import httpx

from webhook_reconciler.modules.ingest import upsert_order
from webhook_reconciler.modules.models import parse_order
from webhook_reconciler.utils import config

logger = logging.getLogger(__name__)

LINK_NEXT_RE = re.compile(r'<([^>]+)>;\s*rel="next"')
SAFETY_BUFFER = timedelta(seconds=60)
DEFAULT_LOOKBACK = timedelta(minutes=5)
PAGE_LIMIT = 250


def _extract_next_url(link_header: str | None) -> str | None:
    if not link_header:
        return None
    match = LINK_NEXT_RE.search(link_header)
    return match.group(1) if match else None


async def _last_seen(conn: asyncpg.Connection) -> datetime:
    row = await conn.fetchval("SELECT MAX(updated_at) FROM orders")
    if row is None:
        return datetime.now(timezone.utc) - DEFAULT_LOOKBACK
    return row - SAFETY_BUFFER


def _build_initial_url(updated_at_min: datetime, base_url: str, api_version: str) -> str:
    # Match the simulator's `Date.toISOString()` format ("...Z" suffix).
    # The backfill server compares timestamps as strings, so an "+00:00"
    # suffix from Python's default isoformat would sort below "Z" and
    # under-restrict the filter.
    iso = updated_at_min.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    return (
        f"{base_url.rstrip('/')}/admin/api/{api_version}/orders.json"
        f"?limit={PAGE_LIMIT}"
        f"&updated_at_min={iso}"
    )


async def _ingest_orders(
    pool: asyncpg.Pool, shop_domain: str, orders: Iterable[dict]
) -> int:
    """Upsert each order. Returns count of orders processed (not necessarily new)."""
    n = 0
    async with pool.acquire() as conn:
        async with conn.transaction():
            for raw in orders:
                record = parse_order(raw, shop_domain)
                await upsert_order(conn, record, source="reconciliation")
                n += 1
    return n


async def reconcile_once(
    pool: asyncpg.Pool,
    client: httpx.AsyncClient,
    *,
    base_url: str | None = None,
    token: str | None = None,
    api_version: str | None = None,
    shop_domain: str = "dtc-apparel.myshopify.com",
) -> int:
    """Run one full reconciliation cycle. Returns number of orders processed."""
    base_url = base_url or config.BACKFILL_URL
    token = token or config.BACKFILL_TOKEN
    api_version = api_version or config.API_VERSION

    async with pool.acquire() as conn:
        last_seen = await _last_seen(conn)

    url: str | None = _build_initial_url(last_seen, base_url, api_version)
    headers = {"X-Shopify-Access-Token": token}
    total = 0

    while url is not None:
        try:
            resp = await client.get(url, headers=headers, timeout=10.0)
        except httpx.HTTPError as exc:
            logger.warning("reconcile fetch failed: %s", exc)
            return total

        if resp.status_code != 200:
            logger.warning("reconcile non-200: %s %s", resp.status_code, resp.text[:200])
            return total

        body = resp.json()
        orders = body.get("orders", [])
        if orders:
            total += await _ingest_orders(pool, shop_domain, orders)

        url = _extract_next_url(resp.headers.get("Link"))

    if total:
        logger.info("reconciliation processed %d orders", total)
    return total
