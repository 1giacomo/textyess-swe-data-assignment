import * as echarts from "echarts";
import { api } from "../api.js";
import { PALETTE } from "../lib/theme.js";

export function initCancellationByReason(el: HTMLElement) {
  const chart = echarts.init(el, "merchant");
  chart.setOption({
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    grid: { left: 100, right: 20, top: 16, bottom: 24 },
    xAxis: { type: "value", axisLabel: { color: PALETTE.textDim } },
    yAxis: {
      type: "category",
      inverse: true,
      axisLabel: { color: PALETTE.textDim },
      data: [],
    },
    series: [
      {
        type: "bar",
        data: [],
        itemStyle: { color: PALETTE.accent, borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: "right", color: PALETTE.text },
      },
    ],
  });

  async function refresh() {
    const { buckets } = await api.cancellationsByReason();
    chart.setOption({
      yAxis: { data: buckets.map((b) => b.reason) },
      series: [{ data: buckets.map((b) => b.count) }],
    });
  }

  return { chart, refresh };
}
