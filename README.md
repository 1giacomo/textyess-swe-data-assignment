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
| Reconciliation   | APScheduler (in-process, every 10s)                   |
| Dashboard (ref.) | Grafana 11 (auto-provisioned datasource + dashboard)  |
| Dashboard (main) | Custom TS + Apache ECharts + Fastify (`dashboard/`)   |
| Orchestration    | Docker Compose                                        |

## Bring it up (one command)

```bash
docker compose up -d --build
```

That launches:

- **PostgreSQL** on `localhost:5433` (host port; container uses 5432)
- **FastAPI** on `localhost:3000` — `POST /webhooks` accepts Shopify deliveries
- **Custom dashboard** on `localhost:3003` — TypeScript + Apache ECharts, polls every 5s
- **Grafana** on `localhost:3002` — kept as a reference dashboard for side-by-side comparison

## Run the simulator against it

The simulator lives in [`./simulator/`](./simulator). Run:

```bash
cd simulator
pnpm install
pnpm start --url http://localhost:3000/webhooks --backfill-port 3001
```

## Tear down

```bash
docker compose down -v   # -v drops the postgres + grafana volumes
```
