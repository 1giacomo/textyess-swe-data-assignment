from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any


@dataclass
class LineItem:
    id: int
    product_id: int | None
    variant_id: int | None
    title: str | None
    sku: str | None
    quantity: int | None
    price: Decimal | None


@dataclass
class OrderRecord:
    order_id: int
    shop_domain: str
    financial_status: str | None
    fulfillment_status: str | None
    total_price: Decimal | None
    cancel_reason: str | None
    cancelled_at: datetime | None
    created_at: datetime | None
    updated_at: datetime
    shipping_latitude: float | None
    shipping_longitude: float | None
    line_items: list[LineItem]


def _parse_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    # Shopify uses ISO-8601 with trailing Z; Python <3.11 doesn't accept "Z"
    text = str(value).replace("Z", "+00:00")
    return datetime.fromisoformat(text)


def _parse_decimal(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    return Decimal(str(value))


def _parse_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_order(payload: dict, shop_domain: str) -> OrderRecord:
    """Extract the fields we materialize from a raw Shopify order payload.

    Cancellation note: cancelled orders arrive as topic ``orders/updated`` with
    ``cancelled_at`` set in the payload. Detection lives here, not in the topic.
    """
    items = [
        LineItem(
            id=int(li["id"]),
            product_id=int(li["product_id"]) if li.get("product_id") else None,
            variant_id=int(li["variant_id"]) if li.get("variant_id") else None,
            title=li.get("title"),
            sku=li.get("sku"),
            quantity=li.get("quantity"),
            price=_parse_decimal(li.get("price")),
        )
        for li in payload.get("line_items", [])
    ]
    shipping = payload.get("shipping_address") or {}
    return OrderRecord(
        order_id=int(payload["id"]),
        shop_domain=shop_domain,
        financial_status=payload.get("financial_status"),
        fulfillment_status=payload.get("fulfillment_status"),
        total_price=_parse_decimal(payload.get("total_price")),
        cancel_reason=payload.get("cancel_reason"),
        cancelled_at=_parse_dt(payload.get("cancelled_at")),
        created_at=_parse_dt(payload.get("created_at")),
        updated_at=_parse_dt(payload.get("updated_at")) or datetime.now(timezone.utc),
        shipping_latitude=_parse_float(shipping.get("latitude")),
        shipping_longitude=_parse_float(shipping.get("longitude")),
        line_items=items,
    )
