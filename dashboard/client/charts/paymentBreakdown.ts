import * as echarts from "echarts";
import { api } from "../api.js";
import { PALETTE } from "../lib/theme.js";

export function initPaymentBreakdown(el: HTMLElement) {
  const chart = echarts.init(el, "merchant");
  chart.setOption({
    tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
    legend: { bottom: 0, left: "center", textStyle: { color: PALETTE.textDim } },
    series: [
      {
        type: "pie",
        radius: ["45%", "70%"],
        center: ["50%", "45%"],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: PALETTE.bg, borderWidth: 2 },
        label: { color: PALETTE.text, formatter: "{b}\n{c}" },
        labelLine: { lineStyle: { color: PALETTE.border } },
        data: [],
      },
    ],
  });

  async function refresh() {
    const { buckets } = await api.paymentBreakdown();
    chart.setOption({
      series: [
        {
          data: buckets.map((b) => ({ name: b.status, value: b.count })),
        },
      ],
    });
  }

  return { chart, refresh };
}
