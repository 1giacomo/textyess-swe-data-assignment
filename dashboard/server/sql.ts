export const SQL = {
  gmv: `
    SELECT COALESCE(SUM(total_price), 0)::float8 AS gmv
    FROM orders
    WHERE cancelled_at IS NULL
      AND created_at >= now() - interval '1 day'
  `,

  paymentBreakdown: `
    SELECT COALESCE(financial_status, 'unknown') AS status,
           COUNT(*)::int AS count
    FROM orders
    WHERE cancelled_at IS NULL
    GROUP BY 1
    ORDER BY count DESC
  `,

  discountImpact: `
    SELECT COALESCE(SUM((payload->>'current_total_discounts')::numeric), 0)::float8 AS discounts
    FROM raw_events
    WHERE topic = 'orders/create'
      AND received_at >= now() - interval '1 day'
  `,

  cancellationsByReason: `
    SELECT COALESCE(cancel_reason, 'unspecified') AS reason,
           COUNT(*)::int AS count
    FROM orders
    WHERE cancelled_at IS NOT NULL
    GROUP BY 1
    ORDER BY count DESC
    LIMIT 10
  `,

  /**
   * $1 = interval (e.g. '1 hour'). Bucketed by minute. Empty buckets are
   * omitted; the client fills gaps with zeros if it cares.
   */
  ordersOverTime: `
    SELECT date_trunc('minute', created_at) AS bucket,
           COUNT(*)::int AS orders
    FROM orders
    WHERE created_at >= now() - $1::interval
    GROUP BY 1
    ORDER BY 1
  `,

  /** $1 = limit (int). */
  topSkus: `
    SELECT oi.sku,
           SUM(oi.quantity * oi.price)::float8 AS revenue,
           SUM(oi.quantity)::int AS units
    FROM order_items oi
    JOIN orders o ON o.order_id = oi.order_id
    WHERE o.cancelled_at IS NULL
      AND oi.sku IS NOT NULL
    GROUP BY oi.sku
    ORDER BY revenue DESC
    LIMIT $1
  `,

  geomap: `
    SELECT shipping_latitude AS lat,
           shipping_longitude AS lng,
           COUNT(*)::int AS orders,
           SUM(total_price)::float8 AS gmv
    FROM orders
    WHERE cancelled_at IS NULL
      AND shipping_latitude IS NOT NULL
      AND shipping_longitude IS NOT NULL
    GROUP BY shipping_latitude, shipping_longitude
  `,

  ingestLag: `
    SELECT EXTRACT(EPOCH FROM (now() - MAX(received_at)))::int AS lag_seconds
    FROM raw_events
  `,

  /** $1 = interval (e.g. '1 hour'). */
  backfillRate: `
    SELECT date_trunc('minute', updated_at) AS bucket,
           COUNT(*)::int AS reconciled
    FROM orders
    WHERE source = 'reconciliation'
      AND updated_at >= now() - $1::interval
    GROUP BY 1
    ORDER BY 1
  `,
} as const;
