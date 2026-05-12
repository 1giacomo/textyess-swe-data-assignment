import * as echarts from "echarts";
import "./lib/theme.js";
import { poll } from "./lib/poll.js";

import { initGmv } from "./charts/gmv.js";
import { initDiscountImpact } from "./charts/discountImpact.js";
import { initPaymentBreakdown } from "./charts/paymentBreakdown.js";
import { initCancellationByReason } from "./charts/cancellationByReason.js";
import { initOrdersOverTime } from "./charts/ordersOverTime.js";
import { initTopSkusByRevenue } from "./charts/topSkusByRevenue.js";
import { initGeomap } from "./charts/geomap.js";
import { initIngestLag } from "./charts/ingestLag.js";
import { initBackfillRate } from "./charts/backfillRate.js";

const REFRESH_MS = 5000;

async function bootstrap() {
  const worldRes = await fetch("/world.geo.json");
  if (!worldRes.ok) throw new Error("failed to load world.geo.json");
  const world = await worldRes.json();
  echarts.registerMap("world", world);

  const panels: Array<{ name: string; el: HTMLElement; init: (el: HTMLElement) => { chart: echarts.ECharts; refresh: () => Promise<void> } }> = [
    { name: "gmv", el: byId("chart-gmv"), init: initGmv },
    { name: "discount", el: byId("chart-discount"), init: initDiscountImpact },
    { name: "payment", el: byId("chart-payment"), init: initPaymentBreakdown },
    { name: "cancel", el: byId("chart-cancel"), init: initCancellationByReason },
    { name: "orders-over-time", el: byId("chart-orders-over-time"), init: initOrdersOverTime },
    { name: "top-skus", el: byId("chart-top-skus"), init: initTopSkusByRevenue },
    { name: "geomap", el: byId("chart-geomap"), init: initGeomap },
    { name: "lag", el: byId("chart-lag"), init: initIngestLag },
    { name: "backfill", el: byId("chart-backfill"), init: initBackfillRate },
  ];

  const instances: Array<{ chart: echarts.ECharts; refresh: () => Promise<void>; name: string }> = [];
  for (const p of panels) {
    const inst = p.init(p.el);
    instances.push({ ...inst, name: p.name });
    poll(async () => {
      try {
        await inst.refresh();
        markStatus(true);
      } catch (err) {
        console.error(`panel ${p.name} refresh failed:`, err);
        markStatus(false);
      }
    }, REFRESH_MS);
  }

  const ro = new ResizeObserver(() => {
    for (const i of instances) i.chart.resize();
  });
  for (const p of panels) ro.observe(p.el);
  window.addEventListener("resize", () => {
    for (const i of instances) i.chart.resize();
  });
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el;
}

let lastOk = true;
function markStatus(ok: boolean) {
  if (ok === lastOk) return;
  lastOk = ok;
  const pill = document.getElementById("status-pill");
  if (!pill) return;
  pill.textContent = ok ? "connected" : "stalled";
  pill.classList.toggle("pill--ok", ok);
  pill.classList.toggle("pill--bad", !ok);
}

bootstrap().catch((err) => {
  console.error(err);
  markStatus(false);
});
