"""FastAPI app entry point.

Owns the lifespan: DB pool, HTTP client, and the reconciliation scheduler.
HTTP routes live in :mod:`shopify_app.api.routes`.
"""

import logging
from contextlib import asynccontextmanager

import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI

from shopify_app.api.routes import router
from shopify_app.modules.reconcile import reconcile_once
from shopify_app.utils import config
from shopify_app.utils.db import create_pool

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.pool = await create_pool()
    app.state.http = httpx.AsyncClient()
    logger.info("DB pool + HTTP client ready")

    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        reconcile_once,
        trigger="interval",
        seconds=config.RECONCILE_INTERVAL_SECONDS,
        kwargs={"pool": app.state.pool, "client": app.state.http},
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()
    app.state.scheduler = scheduler
    logger.info(
        "reconciliation scheduled every %ds against %s",
        config.RECONCILE_INTERVAL_SECONDS,
        config.BACKFILL_URL,
    )

    try:
        yield
    finally:
        scheduler.shutdown(wait=False)
        await app.state.http.aclose()
        await app.state.pool.close()
        logger.info("shutdown complete")


app = FastAPI(title="Shopify Webhook Receiver", lifespan=lifespan)
app.include_router(router)


def run() -> None:
    """Console-script entry point: ``shopify-app`` after ``pip install``."""
    import uvicorn

    uvicorn.run("shopify_app.main:app", host="0.0.0.0", port=3000)
