import * as echarts from "echarts";
import { api } from "../api.js";
import { PALETTE, fmtUsd } from "../lib/theme.js";

export function initGmv(el: HTMLElement) {
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
          color: PALETTE.accent,
          formatter: () => "—",
          offsetCenter: [0, 0],
        },
        data: [{ value: 0 }],
      },
    ],
  });

  async function refresh() {
    const { gmv } = await api.gmv();
    chart.setOption({
      series: [
        {
          detail: { formatter: fmtUsd(gmv) },
          data: [{ value: gmv }],
        },
      ],
    });
  }

  return { chart, refresh };
}
