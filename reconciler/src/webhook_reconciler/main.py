"""FastAPI app entry point.

Owns the lifespan: DB pool, HTTP client, and the reconciliation scheduler.
HTTP routes live in :mod:`webhook_reconciler.api.routes`.
"""

import logging
from contextlib import asynccontextmanager

import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI

from webhook_reconciler.api.routes import router
from webhook_reconciler.modules.reconcile import reconcile_once
from webhook_reconciler.utils import config
from webhook_reconciler.utils.db import create_pool

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.pool = await create_pool()
    app.state.http = httpx.AsyncClient()
    logger.info("DB pool + HTTP client ready")

    async def _scheduled_reconcile() -> None:
        # Read pool/client from app.state at execution time so reconnect
        # logic on the lifespan can swap them out safely.
        await reconcile_once(pool=app.state.pool, client=app.state.http)

    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        _scheduled_reconcile,
        trigger="interval",
        seconds=config.RECONCILE_INTERVAL_SECONDS,
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
    """Console-script entry point: ``webhook-reconciler`` after ``pip install``."""
    import uvicorn

    uvicorn.run("webhook_reconciler.main:app", host="0.0.0.0", port=3000)
