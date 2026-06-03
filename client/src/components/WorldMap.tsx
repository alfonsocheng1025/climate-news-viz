import { useMemo } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import { scaleSequential } from "d3-scale";

const GEO_URL =
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// GDELT sourcecountry 名称 -> 世界地图国家名 的常见映射
const NAME_FIX: Record<string, string> = {
  "United States": "United States of America",
  "Czech Republic": "Czechia",
  "South Korea": "South Korea",
  "Tanzania": "United Republic of Tanzania",
  "Serbia": "Republic of Serbia",
  "Bosnia and Herzegovina": "Bosnia and Herz.",
};

export function WorldMap({
  byCountry,
}: {
  byCountry: Record<string, number>;
}) {
  const max = useMemo(
    () => Math.max(1, ...Object.values(byCountry)),
    [byCountry],
  );
  // 报道强度热力：低->主色浅，高->橙红（呼应「升温」）
  const color = scaleSequential((t: number) => {
    const hue = 184 - t * 178; // teal(184) -> red(6)
    const light = 55 - t * 12;
    return `hsl(${hue}, 70%, ${light}%)`;
  }).domain([0, 1]);

  const lookup = useMemo(() => {
    const m: Record<string, number> = {};
    for (const [k, v] of Object.entries(byCountry)) {
      m[NAME_FIX[k] ?? k] = v;
    }
    return m;
  }, [byCountry]);

  return (
    <ComposableMap
      projection="geoEqualEarth"
      projectionConfig={{ scale: 150 }}
      style={{ width: "100%", height: "100%" }}
    >
      <Geographies geography={GEO_URL}>
        {({ geographies }) =>
          geographies.map((geo) => {
            const name = geo.properties.name;
            const val = lookup[name] ?? 0;
            const fill =
              val > 0
                ? color(val / max)
                : "hsl(var(--secondary))";
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
                <title>{`${name}: ${val.toFixed(1)}%`}</title>
              </Geography>
            );
          })
        }
      </Geographies>
    </ComposableMap>
  );
}
