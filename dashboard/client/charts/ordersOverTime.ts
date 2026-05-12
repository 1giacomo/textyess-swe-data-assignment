import * as echarts from "echarts";
import { api } from "../api.js";
import { PALETTE } from "../lib/theme.js";

export function initOrdersOverTime(el: HTMLElement) {
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
        type: "line",
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2, color: PALETTE.accent },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(92,83,248,0.35)" },
            { offset: 1, color: "rgba(92,83,248,0.0)" },
          ]),
        },
        data: [],
      },
    ],
  });

  async function refresh() {
    const { points } = await api.ordersOverTime("1h");
    chart.setOption({
      series: [
        {
          data: points.map((p) => [p.bucket, p.orders]),
        },
      ],
    });
  }

  return { chart, refresh };
}
