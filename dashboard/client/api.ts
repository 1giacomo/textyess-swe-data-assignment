import type {
  ApiResponse,
  BackfillRateMetric,
  CancellationByReasonMetric,
  DiscountImpactMetric,
  GeomapMetric,
  GmvMetric,
  IngestLagMetric,
  OrdersOverTimeMetric,
  PaymentBreakdownMetric,
  TopSkusMetric,
} from "../shared/types.js";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  const body = (await res.json()) as ApiResponse<T>;
  return body.data;
}

export const api = {
  gmv: () => getJson<GmvMetric>("/api/metrics/gmv"),
  paymentBreakdown: () =>
    getJson<PaymentBreakdownMetric>("/api/metrics/payment-breakdown"),
  discountImpact: () =>
    getJson<DiscountImpactMetric>("/api/metrics/discount-impact"),
  cancellationsByReason: () =>
    getJson<CancellationByReasonMetric>("/api/metrics/cancellations-by-reason"),
  ordersOverTime: (window = "1h") =>
    getJson<OrdersOverTimeMetric>(
      `/api/metrics/orders-over-time?window=${encodeURIComponent(window)}`,
    ),
  topSkus: (limit = 10) =>
    getJson<TopSkusMetric>(`/api/metrics/top-skus?limit=${limit}`),
  geomap: () => getJson<GeomapMetric>("/api/metrics/geomap"),
  ingestLag: () => getJson<IngestLagMetric>("/api/metrics/ingest-lag"),
  backfillRate: (window = "1h") =>
    getJson<BackfillRateMetric>(
      `/api/metrics/backfill-rate?window=${encodeURIComponent(window)}`,
    ),
};
