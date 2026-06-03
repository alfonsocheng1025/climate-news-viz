import { useMemo } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import { scaleSequential } from "d3-scale";

const GEO_URL =
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

/**
 * 热力图：底色按「报道国」（即发布该新闻的媒体所在国）的报道篇数着色。
 * 注意：byCountry 的 key 必须是「世界地图英文国名」(world-atlas properties.name)，
 * 由上层用 fipsToMapName() 把 GDELT 的 FIPS 代码翻译后传入。
 * value 为该国报道的绝对篇数。zhNames 提供英文国名 -> 中文名 用于悬浮提示。
 */
export function WorldMap({
  byCountry,
  zhNames = {},
}: {
  byCountry: Record<string, number>;
  zhNames?: Record<string, string>;
}) {
  const max = useMemo(
    () => Math.max(1, ...Object.values(byCountry)),
    [byCountry],
  );

  // 报道强度热力：低->主色浅青，高->橙红（呼应「升温」）
  const color = scaleSequential((t: number) => {
    const hue = 184 - t * 178; // teal(184) -> red(6)
    const light = 56 - t * 16;
    return `hsl(${hue}, 72%, ${light}%)`;
  }).domain([0, 1]);

  return (
    <ComposableMap
      projection="geoEqualEarth"
      projectionConfig={{ scale: 150 }}
      style={{ width: "100%", height: "100%" }}
    >
      <Geographies geography={GEO_URL}>
        {({ geographies }) =>
          geographies.map((geo) => {
            let name = geo.properties.name as string;
            // 一个中国原则：地图中的「台湾」属于中国，着色与中国一致。
            const isTaiwan = name === "Taiwan";
            if (isTaiwan) name = "China";
            const val = byCountry[name] ?? 0;
            const fill =
              val > 0 ? color(val / max) : "hsl(var(--secondary))";
            const zh = isTaiwan ? "中国台湾" : (zhNames[name] ?? name);
            return (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                fill={fill}
                stroke="hsl(var(--card))"
                strokeWidth={0.5}
                style={{
                  default: { outline: "none" },
                  hover: { outline: "none", fill: "hsl(var(--chart-1))", cursor: "pointer" },
                  pressed: { outline: "none" },
                }}
              >
                <title>{`${zh}：${val} 篇`}</title>
              </Geography>
            );
          })
        }
      </Geographies>
    </ComposableMap>
  );
}
