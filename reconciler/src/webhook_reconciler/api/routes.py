"""HTTP routes — one router for all endpoints."""

from fastapi import APIRouter, Header, HTTPException, Request

from webhook_reconciler.modules.ingest import process_webhook
from webhook_reconciler.modules.reconcile import reconcile_once

router = APIRouter()


@router.get("/health")
async def health(request: Request):
    """Liveness + DB connectivity check."""
    try:
        async with request.app.state.pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"db unreachable: {exc}")
    return {"status": "ok"}


@router.post("/webhooks")
async def webhooks(
    request: Request,
    x_shopify_topic: str = Header(...),
    x_shopify_webhook_id: str = Header(...),
    x_shopify_shop_domain: str = Header("dtc-apparel.myshopify.com"),
):
    payload = await request.json()
    await process_webhook(
        pool=request.app.state.pool,
        webhook_id=x_shopify_webhook_id,
        topic=x_shopify_topic,
        shop_domain=x_shopify_shop_domain,
        payload=payload,
    )
    return {"ok": True}


@router.post("/admin/reconcile")
async def trigger_reconcile(request: Request):
    """Manual reconciliation trigger — useful for tests and demos."""
    n = await reconcile_once(
        pool=request.app.state.pool,
        client=request.app.state.http,
    )
    return {"processed": n}
