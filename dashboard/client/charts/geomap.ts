import * as echarts from "echarts";
import { api } from "../api.js";
import { PALETTE, fmtInt, fmtUsd } from "../lib/theme.js";

export function initGeomap(el: HTMLElement) {
  const chart = echarts.init(el, "merchant");
  chart.setOption({
    tooltip: {
      trigger: "item",
      formatter: (p: unknown) => {
        const obj = p as { value?: [number, number, number, number] };
        if (!obj.value || obj.value.length < 4) return "";
        const [, , orders, gmv] = obj.value;
        return `Orders: ${fmtInt(orders)}<br/>GMV: ${fmtUsd(gmv)}`;
      },
    },
    geo: {
      map: "world",
      roam: true,
      zoom: 1.2,
      center: [10, 25],
      itemStyle: {
        areaColor: "#1a1a2e",
        borderColor: PALETTE.border,
        borderWidth: 0.5,
      },
      emphasis: { itemStyle: { areaColor: "#23233a" }, label: { show: false } },
      label: { show: false },
    },
    series: [
      {
        type: "scatter",
        coordinateSystem: "geo",
        symbolSize: (val: number[]) => {
          const orders = val[2] ?? 0;
          return Math.min(28, 6 + Math.sqrt(orders) * 3);
        },
        itemStyle: {
          color: PALETTE.accent,
          opacity: 0.7,
          shadowBlur: 8,
          shadowColor: PALETTE.accent,
        },
        data: [],
      },
    ],
  });

  async function refresh() {
    const { points } = await api.geomap();
    chart.setOption({
      series: [
        {
          data: points.map((p) => ({
            value: [p.lng, p.lat, p.orders, p.gmv],
          })),
        },
      ],
    });
  }

  return { chart, refresh };
}
