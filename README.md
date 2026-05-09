# Shopify Webhook Ingestion + Reconciliation + Live Dashboard

A working system that ingests Shopify order webhooks, reconciles dropped events
against the Admin REST API, and powers a live merchant dashboard.

The original assignment brief is preserved at [`ASSIGNMENT.md`](./ASSIGNMENT.md).
The design rationale is in [`WRITEUP.md`](./WRITEUP.md).

## Stack

| Layer            | Choice                                                |
| ---------------- | ----------------------------------------------------- |
| Webhook receiver | Python 3.11 + FastAPI + asyncpg                       |
| Storage          | PostgreSQL 16 (raw events JSONB + materialized state) |
| Reconciliation   | APScheduler (in-process, every 30s)                   |
| Dashboard        | Grafana 11 (auto-provisioned datasource + dashboard)  |
| Orchestration    | Docker Compose                                        |

## Bring it up (one command)

```bash
docker compose up -d --build
```

That launches:

- **PostgreSQL** on `localhost:5433` (host port; container uses 5432)
- **FastAPI** on `localhost:3000` — `POST /webhooks` accepts Shopify deliveries
- **Grafana** on `localhost:3002` — anonymous-admin enabled, dashboard auto-loaded

Verify everything is alive:

```bash
curl http://localhost:3000/health        # → {"status":"ok"}
open http://localhost:3002               # Grafana → "DTC Merchant — Live" dashboard
```

## Run the simulator against it

The simulator lives in [`./simulator/`](./simulator). Install once:

```bash
cd simulator && pnpm install
```

Then run any of the assignment scenarios (point all of them at this server's
webhook URL, `http://localhost:3000/webhooks`):

```bash
# Scenario 1 — steady mixed traffic with retries + out-of-order
pnpm simulate --url http://localhost:3000/webhooks \
  --rps 10 --duration 120 \
  --duplicate-rate 0.1 --out-of-order \
  --update-rate 0.3 --cancel-rate 0.05

# Scenario 2 — burst load
pnpm simulate --url http://localhost:3000/webhooks \
  --burst 5000 --concurrency 100

# Scenario 3 — stress workload
pnpm simulate --url http://localhost:3000/webhooks \
  --workload stress --inserts 10000 --updates 5000 --cancels 1000 --concurrency 100

# Scenario 4 — reconciliation against the REST backfill API
pnpm simulate --url http://localhost:3000/webhooks \
  --rps 10 --duration 60 \
  --drop-rate 0.1 \
  --backfill-port 3001
```

Watch the dashboard at `http://localhost:3002` while it runs. Reconciliation
fires every 30 seconds; for Scenario 4, wait ~30s after the simulator finishes
to see the dropped orders backfill into the dashboard.

## Inspect the database

```bash
docker exec -it textyess-swe-data-assignment-postgres-1 psql -U postgres -d shopify

-- core counts
SELECT COUNT(*) FROM raw_events;
SELECT COUNT(*) FROM orders;
SELECT COUNT(*) FROM orders WHERE cancelled_at IS NOT NULL;
SELECT COUNT(*) FROM orders WHERE source = 'reconciliation';

-- compare against the REST backfill (Scenario 4)
SELECT COUNT(*) FROM orders;            -- our state
-- vs:
-- curl -H "X-Shopify-Access-Token: any" \
--      "http://localhost:3001/admin/api/2024-10/orders/count.json"
```

## Run the tests

The Python test suite (idempotency, out-of-order handling, cancellation
detection, line-item replacement, reconciliation pagination) runs inside the
app container against the live Postgres:

```bash
docker exec -e TEST_DATABASE_URL=postgresql://postgres:postgres@postgres:5432/shopify \
  textyess-swe-data-assignment-app-1 \
  python -m pytest tests/ -v
```

10 tests, ~0.4s.

## Tear down

```bash
docker compose down -v   # -v drops the postgres + grafana volumes
```

## Project layout

```
app/                  FastAPI service (Dockerfile, requirements, source, tests)
db/init.sql           Schema applied on first Postgres startup
docker-compose.yml    All three services + healthchecks + volumes
grafana/provisioning/ Auto-provisioned datasource + dashboard
simulator/            Provided Shopify webhook simulator (read-only)
docs/superpowers/     Design spec
ASSIGNMENT.md         Original assignment brief
WRITEUP.md            Design rationale (data model, idempotency, reconciliation, trade-offs)
```

## Endpoints

| Method | Path               | Purpose                                 |
| ------ | ------------------ | --------------------------------------- |
| `GET`  | `/health`          | Liveness + DB connectivity              |
| `POST` | `/webhooks`        | Shopify webhook ingestion               |
| `POST` | `/admin/reconcile` | Manual reconciliation trigger (testing) |

## Notes

- **Postgres host port** is `5433` (not the default `5432`) to avoid conflict
  with a locally-installed Postgres. App-to-DB traffic uses the Docker
  network and the standard `5432`.
- **`host.docker.internal`** is mapped via `extra_hosts: host-gateway` so the
  app container can reach the simulator's backfill server running on the host
  at port 3001 — works on macOS, Windows, and Linux Docker Desktop.
- **Grafana anonymous-admin** is enabled for ease of grading; lock it down
  before any real deployment.
