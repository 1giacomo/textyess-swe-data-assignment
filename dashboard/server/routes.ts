import type { FastifyInstance } from "fastify";
import { pool, ping } from "./db.js";
import { SQL } from "./sql.js";
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

function ok<T>(data: T): ApiResponse<T> {
  return { data };
}

function parseWindow(raw: unknown, fallback: string): string {
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  // Accept only short whitelisted shapes like "30m", "1h", "6h", "1d".
  if (!/^[0-9]{1,3}\s?(m|min|h|hour|d|day)s?$/i.test(raw)) return fallback;
  return raw
    .replace(/^(\d+)\s?m(in)?s?$/i, "$1 minutes")
    .replace(/^(\d+)\s?h(our)?s?$/i, "$1 hours")
    .replace(/^(\d+)\s?d(ay)?s?$/i, "$1 days");
}

function parseLimit(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/health", async (_req, reply) => {
    try {
      await ping();
      return ok({ status: "ok" as const });
    } catch (err) {
      reply.code(503);
      return { error: "db unreachable", detail: String(err) };
    }
  });

  app.get("/api/metrics/gmv", async () => {
    const { rows } = await pool.query<{ gmv: number }>(SQL.gmv);
    return ok<GmvMetric>({ gmv: rows[0]?.gmv ?? 0 });
  });

  app.get("/api/metrics/payment-breakdown", async () => {
    const { rows } = await pool.query<{ status: string; count: number }>(
      SQL.paymentBreakdown,
    );
    return ok<PaymentBreakdownMetric>({ buckets: rows });
  });

  app.get("/api/metrics/discount-impact", async () => {
    const { rows } = await pool.query<{ discounts: number }>(SQL.discountImpact);
    return ok<DiscountImpactMetric>({ discounts: rows[0]?.discounts ?? 0 });
  });

  app.get("/api/metrics/cancellations-by-reason", async () => {
    const { rows } = await pool.query<{ reason: string; count: number }>(
      SQL.cancellationsByReason,
    );
    return ok<CancellationByReasonMetric>({ buckets: rows });
  });

  app.get<{ Querystring: { window?: string } }>(
    "/api/metrics/orders-over-time",
    async (req) => {
      const window = parseWindow(req.query.window, "1 hour");
      const { rows } = await pool.query<{ bucket: Date; orders: number }>(
        SQL.ordersOverTime,
        [window],
      );
      return ok<OrdersOverTimeMetric>({
        points: rows.map((r) => ({
          bucket: r.bucket.toISOString(),
          orders: r.orders,
        })),
      });
    },
  );

  app.get<{ Querystring: { limit?: string } }>(
    "/api/metrics/top-skus",
    async (req) => {
      const limit = parseLimit(req.query.limit, 10, 50);
      const { rows } = await pool.query<{
        sku: string;
        revenue: number;
        units: number;
      }>(SQL.topSkus, [limit]);
      return ok<TopSkusMetric>({ rows });
    },
  );

  app.get("/api/metrics/geomap", async () => {
    const { rows } = await pool.query<{
      lat: number;
      lng: number;
      orders: number;
      gmv: number;
    }>(SQL.geomap);
    return ok<GeomapMetric>({ points: rows });
  });

  app.get("/api/metrics/ingest-lag", async () => {
    const { rows } = await pool.query<{ lag_seconds: number | null }>(
      SQL.ingestLag,
    );
    return ok<IngestLagMetric>({ lag_seconds: rows[0]?.lag_seconds ?? null });
  });

  app.get<{ Querystring: { window?: string } }>(
    "/api/metrics/backfill-rate",
    async (req) => {
      const window = parseWindow(req.query.window, "1 hour");
      const { rows } = await pool.query<{ bucket: Date; reconciled: number }>(
        SQL.backfillRate,
        [window],
      );
      return ok<BackfillRateMetric>({
        points: rows.map((r) => ({
          bucket: r.bucket.toISOString(),
          reconciled: r.reconciled,
        })),
      });
    },
  );
}
