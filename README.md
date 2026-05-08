# Software Engineer, Data — Home Assignment

Build a system that ingests Shopify webhook events in real-time, **reconciles them against a backfill REST API**, and powers a live dashboard for a merchant.

The shape of this assignment intentionally mirrors the kind of work a SWE-Data on a CDP-style team actually does: idempotent ingestion, mutation handling, late/missing event recovery, and turning event streams into something a non-technical user can read.

---

## The merchant

Design for a **high-volume DTC apparel brand**: lots of SKUs (sizes × colors), spiky traffic during drops and sales, frequent order edits and cancellations, returns and refunds, repeat customers.

The dashboard should answer questions a merchant in this space actually asks. You decide which.

## Requirements

You must:

1. **Ingest** Shopify order webhooks (`orders/create`, `orders/updated`).
2. **Reconcile** against the Shopify Admin REST API. **Webhooks are not reliable** — a fraction of webhook deliveries will silently fail. Your system must detect and recover those orders by polling the REST endpoint the simulator exposes.
3. **Transform and store** the data in a way that powers a dashboard.
4. **Render a dashboard** showing meaningful, real-time metrics for the merchant.
5. **Survive duplicate webhooks and out-of-order delivery** without double-counting or losing data. Shopify retries every webhook until it gets a 2xx, and does not guarantee delivery order.
6. Everything must work — we will run it.

## What we provide

A TypeScript simulator (see [`simulator/`](./simulator)) that:

- Posts realistic Shopify webhook payloads (`orders/create`, `orders/updated`, plus `products/*`, `customers/*`) to your endpoint.
- Optionally drops a fraction of webhooks on the floor.
- Optionally exposes a Shopify-shape **Admin REST API** (`/admin/api/2024-10/orders.json`, paginated, auth-required) backed by the same ground truth — so dropped orders are still recoverable.
- Replays duplicate deliveries and out-of-order deliveries on demand.

```bash
cd simulator
pnpm install
pnpm start --url http://localhost:3000/webhooks --backfill-port 3001
```

See [`simulator/README.md`](./simulator/README.md) for all flags.

## What you deliver

1. **A working system** — code + clear instructions to run it. Single-command bring-up wins points.
2. **A live dashboard** showing real-time data from the webhooks.
3. **A short write-up (~1 page)** in `WRITEUP.md`: what you built, why you made the decisions you made, and what you'd improve with more time.

## What we leave open

- **Tech stack** — use whatever you're most effective with.
- **Storage** — SQLite, Postgres, Redis, a file… whatever fits your design.
- **Dashboard** — Metabase, Streamlit, Grafana, custom frontend, whatever you think works best.
- **Infrastructure** — run it locally, deploy it somewhere, your call. Preference: [LocalStack](https://www.localstack.cloud/localstack-for-aws) (free tier covers most AWS services).
- **What to show on the dashboard** — we care about *what you choose to show and why*.
- **Multi-tenancy** — assume a single shop is fine, but be ready to explain how your design would scale to many merchants. The simulator can emit multiple `X-Shopify-Shop-Domain` values via `--shops`.

## Bonus (not required)

- Handle additional webhook types beyond orders (`products/*`, `customers/*`). The simulator emits these via `--topics`.
- Pipeline observability (lag metrics, dead-letter queue, replay tooling, health checks).
- Schema evolution: Shopify deprecates fields every release — how would your system survive a missing/renamed field next year?
- Survive `--workload stress` cleanly (insert/update/cancel batches against your live system).

## Time expectation

Roughly **8–12 hours of focused work**. Don't over-engineer. We'd rather see something that works end-to-end with clear reasoning than a half-finished enterprise architecture.

## How we grade

We will run **exactly** these scenarios against your system. Your `README.md` should explain how to start your system and how to point the simulator at it.

> **Tip:** the simulator just sends HTTP POSTs and serves a small REST mock. It does not need to know anything about your stack. Your job is to make the receiver and reconciliation job robust.

### Scenario 1 — Steady mixed traffic with retries and out-of-order delivery

```bash
pnpm simulate --rps 10 --duration 120 \
  --duplicate-rate 0.1 --out-of-order \
  --update-rate 0.3 --cancel-rate 0.05
```

We check:
- **No duplicate counting.** GMV / order count match the simulator's `sent` minus duplicates.
- **No lost events.** Every unique webhook is reflected in your DB.
- **Updates apply correctly.** `financial_status`, `fulfillment_status`, `cancelled_at` reflect the latest delivery for each `order_id`.

### Scenario 2 — Burst load

```bash
pnpm simulate --burst 5000 --concurrency 100
```

We check:
- **Receiver returns 2xx within reasonable latency** (Shopify retries on >5s).
- **System doesn't crash, stall, or leak memory.**
- **Dashboard queries still respond in < 1s** while the burst is in-flight.

### Scenario 3 — Stress workload

```bash
pnpm simulate --workload stress --inserts 10000 --updates 5000 --cancels 1000 --concurrency 100
```

We check:
- All inserts arrive, all updates apply to the right `order_id`, all cancels correctly mark orders as cancelled.
- Dashboard reflects the final aggregate state (e.g., GMV minus cancellations) within seconds of completion.

### Scenario 4 — Reconciliation against the REST backfill API

```bash
pnpm simulate --rps 10 --duration 60 \
  --drop-rate 0.1 \
  --backfill-port 3001
```

10% of webhooks are silently dropped. The dropped orders **only exist** at `http://localhost:3001/admin/api/2024-10/orders.json` (paginated, requires `X-Shopify-Access-Token` header — any non-empty value).

We check:
- After the simulator stops, your reconciliation job has **recovered every dropped order** from the REST API.
- Final state in your DB matches the REST endpoint's `count.json`.

### Scenario 5 — The write-up

We read `WRITEUP.md`. We expect to see:
- The data model you chose and why (raw events vs. materialized state, idempotency keys, primary key choices).
- How you handle out-of-order and duplicate delivery.
- How your reconciliation job decides what to fetch from REST and how often.
- What you'd build next, and what you'd deliberately *not* build.

## What we're evaluating

- **End-to-end working system.** Can you ship something that actually runs against the five scenarios above?
- **Data thinking.** Modeling, transformation, what to store and how. Idempotency, mutation, time.
- **Product thinking.** What does a merchant actually care about? Does the dashboard reflect that?
- **Decision-making.** The write-up matters. We want your reasoning, not just your code.
- **Code quality.** Clean, readable, well-structured. Not over-abstracted, not a mess.

## How to submit

Pick whichever you prefer:

- **Fork this repo** and open a pull request back to it with your solution, **or**
- **Create your own (private or public) repo** with your solution and share the link with us.

Either way, your repo should contain:

- All your code
- A top-level `README.md` with setup + run instructions (one-command bring-up wins points)
- `WRITEUP.md` with your reasoning

If you create a private repo, share access with the email we used to send you this assignment.

## Questions

If something is genuinely ambiguous, make a decision, document it in `WRITEUP.md`, and move on. That's part of what we're evaluating.

Good luck — we're excited to see what you build.
