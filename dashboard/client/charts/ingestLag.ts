import * as echarts from "echarts";
import { api } from "../api.js";
import { PALETTE } from "../lib/theme.js";

function colorFor(seconds: number | null): string {
  if (seconds === null) return PALETTE.textDim;
  if (seconds < 5) return "#22c55e";
  if (seconds < 30) return "#f59e0b";
  return "#ef4444";
}

export function initIngestLag(el: HTMLElement) {
  const chart = echarts.init(el, "merchant");
  chart.setOption({
    series: [
      {
        type: "gauge",
        startAngle: 200,
        endAngle: -20,
        min: 0,
        max: 1,
        radius: "92%",
        progress: { show: false },
        pointer: { show: false },
        axisLine: { lineStyle: { width: 0 } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        anchor: { show: false },
        title: { show: false },
        detail: {
          valueAnimation: true,
          fontSize: 36,
          fontWeight: 600,
          color: PALETTE.textDim,
          formatter: () => "—",
          offsetCenter: [0, 0],
        },
        data: [{ value: 0 }],
      },
    ],
  });

  async function refresh() {
    const { lag_seconds } = await api.ingestLag();
    const label = lag_seconds === null ? "—" : `${lag_seconds}s`;
    chart.setOption({
      series: [
        {
          detail: { formatter: label, color: colorFor(lag_seconds) },
          data: [{ value: lag_seconds ?? 0 }],
        },
      ],
    });
  }

  return { chart, refresh };
}
