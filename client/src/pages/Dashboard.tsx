import { useMemo, useState } from "react";
import {
  Activity, Globe2, Newspaper, Languages, Moon, Sun, RefreshCw,
  TrendingUp, Smile, MapPin, ExternalLink, AlertTriangle, Leaf,
} from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import {
  useTopics, useArticles, useVolume, useTone, useCountry,
  TIMESPANS, fmtTime, relTime, Article, TimelinePoint,
} from "@/lib/climate";
import { VolumeChart, ToneChart, CountryBar } from "@/components/Charts";
import { WorldMap } from "@/components/WorldMap";
import { Skeleton } from "@/components/ui/skeleton";

function avg(data: TimelinePoint[]) {
  if (!data.length) return 0;
  return data.reduce((s, d) => s + d.value, 0) / data.length;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-card-border bg-card ${className}`}>{children}</div>
  );
}

function PanelHead({ icon: Icon, title, sub }: { icon: any; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2 px-5 pt-4 pb-3 border-b border-border">
      <Icon className="size-4 text-primary" />
      <h2 className="text-sm font-semibold">{title}</h2>
      {sub && <span className="ml-auto text-xs text-muted-foreground tabular-nums">{sub}</span>}
    </div>
  );
}

export default function Dashboard() {
  const { theme, toggle } = useTheme();
  const [topic, setTopic] = useState("climate_change");
  const [timespan, setTimespan] = useState("1d");

  const topics = useTopics();
  const articles = useArticles(topic, timespan, 60);
  const volume = useVolume(topic, timespan);
  const tone = useTone(topic, timespan);
  const country = useCountry(topic, timespan);

  const volData = volume.data?.timeline?.[0]?.data ?? [];
  const toneData = tone.data?.timeline?.[0]?.data ?? [];
  const arts: Article[] = articles.data?.articles ?? [];

  // 国家维度：取每个 series 在时间窗内的均值
  const countrySeries = country.data?.timeline ?? [];
  const countryAgg = useMemo(() => {
    const out = countrySeries
      .map((s) => ({ country: s.series, value: avg(s.data) }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
    return out;
  }, [countrySeries]);
  const countryMap = useMemo(
    () => Object.fromEntries(countryAgg.map((d) => [d.country, d.value])),
    [countryAgg],
  );

  // KPI
  const latestVol = volData.at(-1)?.value ?? 0;
  const avgTone = avg(toneData);
  const topCountry = countryAgg[0]?.country ?? "—";
  const langCount = new Set(arts.map((a) => a.language)).size;

  const loadingAny = volume.isLoading || tone.isLoading || articles.isLoading;
  const rateLimited =
    (volume.error as any)?.message?.includes("429") ||
    (articles.error as any)?.message?.includes("429");

  const refetchAll = () => {
    volume.refetch(); tone.refetch(); country.refetch(); articles.refetch();
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 h-16 flex items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Leaf className="size-5" />
            </div>
            <div className="leading-tight">
              <h1 className="text-base font-bold tracking-tight">气候新闻实时观测</h1>
              <p className="text-xs text-muted-foreground">GDELT Climate News Monitor</p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-primary" />
              </span>
              每 15 分钟更新
            </span>
            <button
              onClick={refetchAll}
              data-testid="button-refresh"
              className="grid size-9 place-items-center rounded-lg border border-border hover:bg-muted"
              aria-label="刷新数据"
            >
              <RefreshCw className={`size-4 ${loadingAny ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={toggle}
              data-testid="button-theme"
              className="grid size-9 place-items-center rounded-lg border border-border hover:bg-muted"
              aria-label="切换深浅色"
            >
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 sm:px-6 py-5 space-y-5">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5">
            {(topics.data ?? []).map((t) => (
              <button
                key={t.key}
                onClick={() => setTopic(t.key)}
                data-testid={`topic-${t.key}`}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  topic === t.key
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border bg-card hover:bg-muted text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex gap-1 rounded-lg border border-border bg-card p-1">
            {TIMESPANS.map((t) => (
              <button
                key={t.value}
                onClick={() => setTimespan(t.value)}
                data-testid={`timespan-${t.value}`}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  timespan === t.value
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {rateLimited && (
          <div className="flex items-center gap-2 rounded-lg border border-chart-4/40 bg-chart-4/10 px-4 py-2.5 text-sm">
            <AlertTriangle className="size-4 text-chart-4" />
            GDELT 接口短暂限流，系统正在自动重试，数据稍后刷新。
          </div>
        )}

        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi icon={TrendingUp} label="当前报道强度" value={`${latestVol.toFixed(2)}%`} hint="占全球新闻比例" tone="primary" />
          <Kpi
            icon={Smile}
            label="平均情感倾向"
            value={avgTone.toFixed(2)}
            hint={avgTone >= 0 ? "整体偏正面" : "整体偏负面"}
            tone={avgTone >= 0 ? "good" : "warn"}
          />
          <Kpi icon={Globe2} label="报道最多地区" value={topCountry} hint="按来源国家" tone="primary" />
          <Kpi icon={Languages} label="覆盖语言数" value={String(langCount)} hint="最新文章样本" tone="primary" />
        </div>

        {/* Charts grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <Card className="lg:col-span-2">
            <PanelHead icon={Activity} title="报道量趋势" sub="% of global coverage" />
            <div className="h-64 p-4">
              {volume.isLoading ? <ChartSkeleton /> : <VolumeChart data={volData} />}
            </div>
          </Card>
          <Card>
            <PanelHead icon={Smile} title="情感趋势" sub="avg tone" />
            <div className="h-64 p-4">
              {tone.isLoading ? <ChartSkeleton /> : <ToneChart data={toneData} />}
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <Card className="lg:col-span-2">
            <PanelHead icon={MapPin} title="全球报道热力图" sub="按来源国家" />
            <div className="h-[360px] p-2">
              {country.isLoading ? (
                <ChartSkeleton />
              ) : (
                <WorldMap byCountry={countryMap} />
              )}
            </div>
          </Card>
          <Card>
            <PanelHead icon={Globe2} title="国家 / 地区排行" sub="Top 12" />
            <div className="h-[360px] p-3">
              {country.isLoading ? <ChartSkeleton /> : <CountryBar data={countryAgg.slice(0, 12)} />}
            </div>
          </Card>
        </div>

        {/* Article feed */}
        <Card>
          <PanelHead icon={Newspaper} title="最新报道流" sub={`${arts.length} 篇 · 实时`} />
          <div className="p-3">
            {articles.isLoading ? (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-28 rounded-lg" />
                ))}
              </div>
            ) : arts.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                当前时间窗内暂无匹配报道，试试放宽时间范围。
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {arts.map((a, i) => (
                  <ArticleCard key={a.url + i} a={a} />
                ))}
              </div>
            )}
          </div>
        </Card>

        <footer className="pt-2 pb-8 text-center text-xs text-muted-foreground">
          数据来源：
          <a href="https://www.gdeltproject.org/" target="_blank" rel="noreferrer" className="underline hover:text-foreground">
            The GDELT Project
          </a>
          {" · "}DOC 2.0 实时 API（每 15 分钟更新，覆盖最近 3 个月）。原型阶段（方案 B），后端已预留切换到自建数据库（方案 A）的抽象层。
        </footer>
      </main>
    </div>
  );
}

function Kpi({
  icon: Icon, label, value, hint, tone,
}: {
  icon: any; label: string; value: string; hint: string;
  tone: "primary" | "good" | "warn";
}) {
  const toneColor =
    tone === "good" ? "text-chart-1" : tone === "warn" ? "text-chart-5" : "text-primary";
  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className={`size-3.5 ${toneColor}`} />
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums truncate" data-testid={`kpi-${label}`}>
        {value}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
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
      className="group flex flex-col rounded-lg border border-border bg-card-foreground/[0.015] overflow-hidden hover:border-primary/60 transition-colors"
    >
      {a.socialimage ? (
        <div className="h-28 overflow-hidden bg-muted">
          <img
            src={a.socialimage}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
          />
        </div>
      ) : (
        <div className="h-28 grid place-items-center bg-muted text-muted-foreground">
          <Newspaper className="size-6 opacity-40" />
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="text-sm font-medium leading-snug line-clamp-3 group-hover:text-primary">
          {a.title}
        </p>
        <div className="mt-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate max-w-[7rem]">{a.domain}</span>
          <span>·</span>
          <span className="truncate max-w-[5rem]">{a.sourcecountry}</span>
          <ExternalLink className="size-3 ml-auto opacity-0 group-hover:opacity-100" />
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">{relTime(a.seendate)}</div>
      </div>
    </a>
  );
}

function ChartSkeleton() {
  return <Skeleton className="h-full w-full rounded-lg" />;
}
