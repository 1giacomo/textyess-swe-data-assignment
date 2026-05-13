export type GmvMetric = { gmv: number };

export type PaymentBreakdownMetric = {
  buckets: Array<{ status: string; count: number }>;
};

export type DiscountImpactMetric = { discounts: number };

export type CancellationByReasonMetric = {
  buckets: Array<{ reason: string; count: number }>;
};

export type OrdersOverTimeMetric = {
  points: Array<{ bucket: string; orders: number }>;
};

export type TopSkusMetric = {
  rows: Array<{ sku: string; revenue: number; units: number }>;
};

export type GeomapMetric = {
  points: Array<{ lat: number; lng: number; orders: number; gmv: number }>;
};

export type IngestLagMetric = { lag_seconds: number | null };

export type BackfillRateMetric = {
  points: Array<{ bucket: string; reconciled: number }>;
};

export type ApiResponse<T> = { data: T };
