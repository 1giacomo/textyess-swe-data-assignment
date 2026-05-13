import * as echarts from "echarts";
import { api } from "../api.js";
import { PALETTE } from "../lib/theme.js";

export function initBackfillRate(el: HTMLElement) {
  const chart = echarts.init(el, "merchant");
  chart.setOption({
    tooltip: { trigger: "axis" },
    grid: { left: 40, right: 16, top: 24, bottom: 28 },
    xAxis: {
      type: "time",
      axisLabel: { color: PALETTE.textDim, hideOverlap: true },
    },
    yAxis: { type: "value", minInterval: 1 },
    series: [
      {
        type: "bar",
        itemStyle: { color: PALETTE.accentSoft, borderRadius: [4, 4, 0, 0] },
        data: [],
      },
    ],
  });

  async function refresh() {
    const { points } = await api.backfillRate("1h");
    chart.setOption({
      series: [
        {
          data: points.map((p) => [p.bucket, p.reconciled]),
        },
      ],
    });
  }

  return { chart, refresh };
}
