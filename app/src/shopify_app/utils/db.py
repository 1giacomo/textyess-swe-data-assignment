import asyncpg

from shopify_app.utils import config


async def create_pool() -> asyncpg.Pool:
    return await asyncpg.create_pool(
        dsn=config.DATABASE_URL,
        min_size=config.POOL_MIN_SIZE,
        max_size=config.POOL_MAX_SIZE,
        command_timeout=10,
    )
