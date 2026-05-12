import * as echarts from "echarts";
import { api } from "../api.js";
import { PALETTE, fmtUsd } from "../lib/theme.js";

export function initDiscountImpact(el: HTMLElement) {
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
          color: PALETTE.accentSoft,
          formatter: () => "—",
          offsetCenter: [0, 0],
        },
        data: [{ value: 0 }],
      },
    ],
  });

  async function refresh() {
    const { discounts } = await api.discountImpact();
    chart.setOption({
      series: [
        {
          detail: { formatter: fmtUsd(discounts) },
          data: [{ value: discounts }],
        },
      ],
    });
  }

  return { chart, refresh };
}
