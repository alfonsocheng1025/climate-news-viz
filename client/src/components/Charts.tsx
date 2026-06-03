import {
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Brush,
  Cell,
} from "recharts";
import { TimelinePoint, fmtTime, parseGdeltDate } from "@/lib/climate";

export type Granularity = "hour" | "day" | "month" | "year";

// 按粒度将时间点聚合（年/月/日/时）；取同桶均值（报道强度/情感都是百分比/均值语义）。
export function bucketByGranularity(
  data: TimelinePoint[],
  g: Granularity,
): TimelinePoint[] {
  if (g === "hour" || data.length === 0) return data;
  const keyOf = (d: Date): string => {
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
    const da = String(d.getUTCDate()).padStart(2, "0");
    if (g === "year") return `${y}-01-01T00:00Z`;
    if (g === "month") return `${y}-${mo}-01T00:00Z`;
    return `${y}-${mo}-${da}T00:00Z`; // day
  };
  const acc = new Map<string, { sum: number; n: number }>();
  const order: string[] = [];
  for (const p of data) {
    const d = parseGdeltDate(p.date);
    if (isNaN(d.getTime())) continue;
    const k = keyOf(d);
    if (!acc.has(k)) {
      acc.set(k, { sum: 0, n: 0 });
      order.push(k);
    }
    const e = acc.get(k)!;
    e.sum += p.value;
    e.n += 1;
  }
  return order.map((k) => {
    const e = acc.get(k)!;
    return { date: k, value: e.n ? e.sum / e.n : 0 };
  });
}

const axisStyle = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const gridColor = "hsl(var(--border))";

function tooltipStyle() {
  return {
    background: "hsl(var(--popover))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 10,
    fontSize: 12,
    boxShadow: "0 8px 24px -12px hsl(var(--foreground) / 0.3)",
    color: "hsl(var(--popover-foreground))",
  };
}

function tickFmt(s: string) {
  const f = fmtTime(s);
  if (!f || f.includes("NaN") || f === "Invalid Date") return "";
  const parts = f.split(" ");
  // f 形如 "06/03 10:00"；优先显示时:分，整点 00:00 显示日期
  const time = parts[1] ?? f;
  return time.startsWith("00:00") ? parts[0] : time;
}

function tickFmtFor(g: Granularity) {
  return (s: string) => {
    const d = parseGdeltDate(s);
    if (isNaN(d.getTime())) return "";
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
    const da = String(d.getUTCDate()).padStart(2, "0");
    if (g === "year") return `${y}`;
    if (g === "month") return `${y}/${mo}`;
    if (g === "day") return `${mo}/${da}`;
    return tickFmt(s); // hour
  };
}

function labelFmtFor(g: Granularity) {
  return (l: any) => {
    const d = parseGdeltDate(String(l));
    if (isNaN(d.getTime())) return String(l);
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
    const da = String(d.getUTCDate()).padStart(2, "0");
    if (g === "year") return `${y} 年`;
    if (g === "month") return `${y} 年 ${mo} 月`;
    if (g === "day") return `${y}/${mo}/${da}`;
    return fmtTime(String(l)); // hour
  };
}

export function VolumeChart({
  data,
  granularity = "hour",
  showBrush = false,
}: {
  data: TimelinePoint[];
  granularity?: Granularity;
  showBrush?: boolean;
}) {
  const tf = tickFmtFor(granularity);
  const lf = labelFmtFor(granularity);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart
        data={data}
        margin={{ top: 8, right: 8, left: -16, bottom: showBrush ? 4 : 0 }}
      >
        <defs>
          <linearGradient id="volFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.45} />
            <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
        <XAxis dataKey="date" tickFormatter={tf} tick={axisStyle} tickLine={false} axisLine={false} minTickGap={40} />
        <YAxis tick={axisStyle} tickLine={false} axisLine={false} width={44} />
        <Tooltip
          contentStyle={tooltipStyle()}
          labelFormatter={lf}
          formatter={(v: number) => [`${v.toFixed(2)}%`, "报道强度"]}
        />
        <Area type="monotone" dataKey="value" stroke="hsl(var(--chart-1))" strokeWidth={2} fill="url(#volFill)" />
        {showBrush && data.length > 4 && (
          <Brush
            dataKey="date"
            height={22}
            travellerWidth={8}
            stroke="hsl(var(--chart-1))"
            fill="hsl(var(--muted) / 0.4)"
            tickFormatter={tf}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ToneChart({ data }: { data: TimelinePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
        <XAxis dataKey="date" tickFormatter={tickFmt} tick={axisStyle} tickLine={false} axisLine={false} minTickGap={40} />
        <YAxis tick={axisStyle} tickLine={false} axisLine={false} width={44} />
        <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
        <Tooltip
          contentStyle={tooltipStyle()}
          labelFormatter={(l) => fmtTime(String(l))}
          formatter={(v: number) => [v.toFixed(3), "平均情感"]}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke="hsl(var(--chart-4))"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function CountryBar({ data, unit = "" }: { data: { country: string; value: number }[]; unit?: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
        <XAxis type="number" tick={axisStyle} tickLine={false} axisLine={false} />
        <YAxis
          type="category"
          dataKey="country"
          tick={{ ...axisStyle, fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={92}
        />
        <Tooltip
          contentStyle={tooltipStyle()}
          formatter={(v: number) => [`${v} ${unit}`.trim(), "报道篇数"]}
          cursor={{ fill: "hsl(var(--muted))" }}
        />
        <Bar dataKey="value" radius={[0, 5, 5, 0]} maxBarSize={22}>
          {data.map((_, i) => (
            <Cell key={i} fill={`hsl(var(--chart-${(i % 6) + 1}))`} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
