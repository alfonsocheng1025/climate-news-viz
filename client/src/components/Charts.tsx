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
  Cell,
} from "recharts";
import { TimelinePoint, fmtTime } from "@/lib/climate";

const axisStyle = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const gridColor = "hsl(var(--border))";

function tooltipStyle() {
  return {
    background: "hsl(var(--popover))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 8,
    fontSize: 12,
    color: "hsl(var(--popover-foreground))",
  };
}

function tickFmt(s: string) {
  const f = fmtTime(s);
  return f.slice(0, 5) === "00:00" ? f.split(" ")[0] : f.split(" ")[1] ?? f;
}

export function VolumeChart({ data }: { data: TimelinePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="volFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.45} />
            <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
        <XAxis dataKey="date" tickFormatter={tickFmt} tick={axisStyle} tickLine={false} axisLine={false} minTickGap={40} />
        <YAxis tick={axisStyle} tickLine={false} axisLine={false} width={44} />
        <Tooltip
          contentStyle={tooltipStyle()}
          labelFormatter={(l) => fmtTime(String(l))}
          formatter={(v: number) => [`${v.toFixed(2)}%`, "报道强度"]}
        />
        <Area type="monotone" dataKey="value" stroke="hsl(var(--chart-1))" strokeWidth={2} fill="url(#volFill)" />
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

export function CountryBar({ data }: { data: { country: string; value: number }[] }) {
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
          formatter={(v: number) => [`${v.toFixed(1)}%`, "报道占比"]}
          cursor={{ fill: "hsl(var(--muted))" }}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={`hsl(var(--chart-${(i % 5) + 1}))`} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
