"""Test fixtures.

Tests run against the live Postgres container. Each test wraps its work in a
transaction that is rolled back at teardown, so tests are isolated.
"""

import os

import asyncpg
import pytest_asyncio

TEST_DSN = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5433/shopify",
)


@pytest_asyncio.fixture
async def conn():
    """A fresh connection wrapped in a rolled-back transaction per test."""
    connection = await asyncpg.connect(dsn=TEST_DSN)
    tx = connection.transaction()
    await tx.start()
    try:
        yield connection
    finally:
        await tx.rollback()
        await connection.close()
