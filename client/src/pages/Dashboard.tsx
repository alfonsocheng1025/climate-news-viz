import { useMemo, useState } from "react";
import {
  Activity, Globe2, Newspaper, Languages, Moon, Sun, RefreshCw,
  TrendingUp, Smile, MapPin, ExternalLink, AlertTriangle, Leaf,
  ArrowUpRight, ArrowDownRight, Minus,
} from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import {
  TOPICS, useArticles, useVolume, useTone, useCountry,
  TIMESPANS, fmtTime, relTime, Article, TimelinePoint,
} from "@/lib/climate";
import { VolumeChart, ToneChart, CountryBar } from "@/components/Charts";
import { WorldMap } from "@/components/WorldMap";
import { Skeleton } from "@/components/ui/skeleton";

function avg(data: TimelinePoint[]) {
  if (!data.length) return 0;
  return data.reduce((s, d) => s + d.value, 0) / data.length;
}

function Panel({
  icon: Icon, title, sub, className = "", children,
}: {
  icon: any; title: string; sub?: string; className?: string; children: React.ReactNode;
}) {
  return (
    <section className={`panel flex flex-col overflow-hidden ${className}`}>
      <div className="flex items-center gap-2.5 px-5 pt-4 pb-3">
        <span className="grid size-7 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" />
        </span>
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {sub && (
          <span className="ml-auto text-xs font-medium text-muted-foreground num">{sub}</span>
        )}
      </div>
      <div className="h-px bg-card-border" />
      {children}
    </section>
  );
}

export default function Dashboard() {
  const { theme, toggle } = useTheme();
  const [topic, setTopic] = useState("climate_change");
  const [timespan, setTimespan] = useState("1d");

  const articles = useArticles(topic, timespan, 60);
  const volume = useVolume(topic, timespan);
  const tone = useTone(topic, timespan);
  const country = useCountry(topic, timespan);

  const volData = volume.data?.timeline?.[0]?.data ?? [];
  const toneData = tone.data?.timeline?.[0]?.data ?? [];
  const arts: Article[] = articles.data?.articles ?? [];

  const countrySeries = country.data?.timeline ?? [];
  const countryAgg = useMemo(() => {
    return countrySeries
      .map((s) => ({ country: s.series, value: avg(s.data) }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [countrySeries]);
  const countryMap = useMemo(
    () => Object.fromEntries(countryAgg.map((d) => [d.country, d.value])),
    [countryAgg],
  );

  // KPI values + simple trend deltas
  const latestVol = volData.at(-1)?.value ?? 0;
  const prevVol = volData.at(-2)?.value ?? latestVol;
  const volDelta = latestVol - prevVol;
  const avgTone = avg(toneData);
  const topCountry = countryAgg[0]?.country ?? "—";
  const langCount = new Set(arts.map((a) => a.language)).size;
  const activeTopic = TOPICS.find((t) => t.key === topic);

  const loadingAny = volume.isLoading || tone.isLoading || articles.isLoading;
  const isRate = (e: unknown) =>
    (e as any)?.message?.includes("429") ||
    (e as any)?.message?.includes("rate_limited");
  const rateLimited =
    isRate(volume.error) || isRate(articles.error) || isRate(tone.error);

  const refetchAll = () => {
    volume.refetch(); tone.refetch(); country.refetch(); articles.refetch();
  };

  return (
    <div className="relative min-h-screen text-foreground">
      <div className="app-ambient" aria-hidden />

      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/70 backdrop-blur-xl">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 h-16 flex items-center gap-3">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-primary to-chart-3 text-primary-foreground shadow-sm">
              <Leaf className="size-5" />
            </div>
            <div className="leading-tight">
              <h1 className="font-display text-[1.05rem] font-bold tracking-tight">气候新闻实时观测</h1>
              <p className="text-xs text-muted-foreground">GDELT Climate News Monitor</p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/8 px-3 py-1.5 text-xs font-medium text-primary">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-primary" />
              </span>
              每 15 分钟更新
            </span>
            <button
              onClick={refetchAll}
              data-testid="button-refresh"
              className="grid size-9 place-items-center rounded-lg border border-border bg-card hover-elevate"
              aria-label="刷新数据"
            >
              <RefreshCw className={`size-4 ${loadingAny ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={toggle}
              data-testid="button-theme"
              className="grid size-9 place-items-center rounded-lg border border-border bg-card hover-elevate"
              aria-label="切换深浅色"
            >
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 sm:px-6 py-6 space-y-5">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1.5">
            {TOPICS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTopic(t.key)}
                data-testid={`topic-${t.key}`}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium border transition-all ${
                  topic === t.key
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "border-border bg-card text-muted-foreground hover-elevate hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex gap-0.5 rounded-full border border-border bg-card p-1">
            {TIMESPANS.map((t) => (
              <button
                key={t.value}
                onClick={() => setTimespan(t.value)}
                data-testid={`timespan-${t.value}`}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                  timespan === t.value
                    ? "bg-secondary text-secondary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {rateLimited && (
          <div className="flex items-center gap-2 rounded-xl border border-chart-4/40 bg-chart-4/10 px-4 py-2.5 text-sm">
            <AlertTriangle className="size-4 shrink-0 text-chart-4" />
            GDELT 接口短暂限流，系统正在自动重试，数据将在入库后自动刷新。
          </div>
        )}

        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi
            icon={TrendingUp} label="当前报道强度" value={`${latestVol.toFixed(2)}%`}
            hint="占全球新闻比例" accent="chart-1" delta={volDelta}
          />
          <Kpi
            icon={Smile} label="平均情感倾向" value={avgTone.toFixed(2)}
            hint={avgTone >= 0 ? "整体偏正面" : "整体偏负面"}
            accent={avgTone >= 0 ? "chart-3" : "chart-5"}
          />
          <Kpi
            icon={Globe2} label="报道最多地区" value={topCountry}
            hint="按来源国家" accent="chart-2"
          />
          <Kpi
            icon={Languages} label="覆盖语言数" value={String(langCount)}
            hint="最新文章样本" accent="chart-6"
          />
        </div>

        {/* Trend charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Panel icon={Activity} title="报道量趋势" sub="% of global coverage" className="lg:col-span-2">
            <div className="h-64 p-4">
              {volume.isLoading ? <ChartSkeleton /> :
                volData.length === 0 ? <EmptyChart label="暂无趋势数据" /> :
                <VolumeChart data={volData} />}
            </div>
          </Panel>
          <Panel icon={Smile} title="情感趋势" sub="avg tone">
            <div className="h-64 p-4">
              {tone.isLoading ? <ChartSkeleton /> :
                toneData.length === 0 ? <EmptyChart label="暂无情感数据" /> :
                <ToneChart data={toneData} />}
            </div>
          </Panel>
        </div>

        {/* Map + ranking */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Panel icon={MapPin} title="全球报道热力图" sub="按来源国家" className="lg:col-span-2">
            <div className="h-[360px] p-2">
              {country.isLoading ? <ChartSkeleton /> : <WorldMap byCountry={countryMap} />}
            </div>
          </Panel>
          <Panel icon={Globe2} title="国家 / 地区排行" sub="Top 12">
            <div className="h-[360px] p-3">
              {country.isLoading ? <ChartSkeleton /> :
                countryAgg.length === 0 ? <EmptyChart label="暂无地区数据" /> :
                <CountryBar data={countryAgg.slice(0, 12)} />}
            </div>
          </Panel>
        </div>

        {/* Article feed */}
        <Panel icon={Newspaper} title="最新报道流" sub={`${arts.length} 篇 · 实时`}>
          <div className="p-4">
            {articles.isLoading ? (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-44 rounded-xl" />
                ))}
              </div>
            ) : arts.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-16 text-center">
                <span className="grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
                  <Newspaper className="size-6 opacity-50" />
                </span>
                <p className="text-sm text-muted-foreground">
                  当前时间窗内暂无 {activeTopic?.label ?? ""} 报道，数据将在入库后自动出现。
                </p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {arts.map((a, i) => (
                  <ArticleCard key={a.url + i} a={a} />
                ))}
              </div>
            )}
          </div>
        </Panel>

        <footer className="pt-2 pb-8 text-center text-xs text-muted-foreground">
          数据来源：
          <a href="https://www.gdeltproject.org/" target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
            The GDELT Project
          </a>
          {" · "}DOC 2.0 实时 API（每 15 分钟入库 · 覆盖最近 3 个月）· 数据持久化于 Supabase。
        </footer>
      </main>
    </div>
  );
}

function Kpi({
  icon: Icon, label, value, hint, accent, delta,
}: {
  icon: any; label: string; value: string; hint: string;
  accent: string; delta?: number;
}) {
  const showDelta = typeof delta === "number" && Math.abs(delta) > 0.0001;
  const up = (delta ?? 0) > 0;
  return (
    <div className="panel relative overflow-hidden p-4">
      <span
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: `hsl(var(--${accent}))` }}
        aria-hidden
      />
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className="grid size-6 place-items-center rounded-md"
          style={{ background: `hsl(var(--${accent}) / 0.12)`, color: `hsl(var(--${accent}))` }}>
          <Icon className="size-3.5" />
        </span>
        {label}
      </div>
      <div className="mt-2.5 flex items-end gap-2">
        <div className="font-display text-2xl font-bold leading-none num truncate" data-testid={`kpi-${label}`}>
          {value}
        </div>
        {showDelta && (
          <span className={`mb-0.5 inline-flex items-center gap-0.5 text-xs font-semibold num ${up ? "text-chart-3" : "text-chart-5"}`}>
            {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
            {Math.abs(delta as number).toFixed(2)}
          </span>
        )}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

function ArticleCard({ a }: { a: Article }) {
  return (
    <a
      href={a.url}
      target="_blank"
      rel="noreferrer"
      data-testid="card-article"
      className="group flex flex-col overflow-hidden rounded-xl border border-card-border bg-card transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
    >
      {a.socialimage ? (
        <div className="relative h-28 overflow-hidden bg-muted">
          <img
            src={a.socialimage}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
        </div>
      ) : (
        <div className="grid h-28 place-items-center bg-gradient-to-br from-muted to-secondary text-muted-foreground">
          <Leaf className="size-6 opacity-30" />
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <p className="line-clamp-3 text-sm font-medium leading-snug transition-colors group-hover:text-primary">
          {a.title}
        </p>
        <div className="mt-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="max-w-[7rem] truncate font-medium">{a.domain}</span>
          <span className="text-card-border">·</span>
          <span className="max-w-[5rem] truncate">{a.sourcecountry}</span>
          <ExternalLink className="ml-auto size-3 opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
        <div className="num text-xs text-muted-foreground">{relTime(a.seendate)}</div>
      </div>
    </a>
  );
}

function ChartSkeleton() {
  return <Skeleton className="h-full w-full rounded-xl" />;
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="grid h-full place-items-center">
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        <Minus className="size-5 opacity-40" />
        <span className="text-xs">{label}</span>
      </div>
    </div>
  );
}
