import * as echarts from "echarts";
import { api } from "../api.js";
import { PALETTE, fmtUsd } from "../lib/theme.js";

export function initTopSkusByRevenue(el: HTMLElement) {
  const chart = echarts.init(el, "merchant");
  chart.setOption({
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: unknown) => {
        const p = Array.isArray(params) ? params[0] : params;
        if (!p || typeof p !== "object") return "";
        const obj = p as { name: string; value: number; data?: { units?: number } };
        const units = obj.data?.units ?? 0;
        return `${obj.name}<br/>Revenue: ${fmtUsd(obj.value)}<br/>Units: ${units}`;
      },
    },
    grid: { left: 100, right: 60, top: 16, bottom: 24 },
    xAxis: {
      type: "value",
      axisLabel: { color: PALETTE.textDim, formatter: (v: number) => fmtUsd(v) },
    },
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
        label: {
          show: true,
          position: "right",
          color: PALETTE.text,
          formatter: (p: { value: number }) => fmtUsd(p.value),
        },
      },
    ],
  });

  async function refresh() {
    const { rows } = await api.topSkus(10);
    chart.setOption({
      yAxis: { data: rows.map((r) => r.sku) },
      series: [
        {
          data: rows.map((r) => ({ value: r.revenue, units: r.units })),
        },
      ],
    });
  }

  return { chart, refresh };
}
