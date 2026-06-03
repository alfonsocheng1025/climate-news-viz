import { useMemo, useState, useEffect } from "react";
import {
  Activity, Globe2, Newspaper, Languages, Moon, Sun, RefreshCw,
  TrendingUp, Smile, MapPin, ExternalLink, AlertTriangle, Leaf,
  ArrowUpRight, ArrowDownRight, Minus, Building2, Cloud, Tags,
  Heart, Database, Scale, Clock,
} from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import {
  TOPICS, useArticles, useVolume, useTone, useCountry,
  TIMESPANS, relTime, Article, TimelinePoint,
} from "@/lib/climate";
import { fipsToZh, fipsToMapName } from "@/lib/countries";
import { buildWordCloud, buildEntities, buildOutletRanking, decodeEntities } from "@/lib/textmine";
import { VolumeChart, ToneChart, CountryBar } from "@/components/Charts";
import { WorldMap } from "@/components/WorldMap";
import { InfoTip, WordCloud, HBarRank, Pager } from "@/components/Extras";
import { Skeleton } from "@/components/ui/skeleton";

function avg(data: TimelinePoint[]) {
  if (!data.length) return 0;
  return data.reduce((s, d) => s + d.value, 0) / data.length;
}

const PAGE_SIZE = 12;

function Panel({
  icon: Icon, title, sub, info, className = "", children,
}: {
  icon: any; title: string; sub?: string; info?: string;
  className?: string; children: React.ReactNode;
}) {
  return (
    <section className={`panel flex flex-col overflow-hidden ${className}`}>
      <div className="flex items-center gap-2.5 px-5 pt-4 pb-3">
        <span className="grid size-7 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" />
        </span>
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {info && <InfoTip text={info} />}
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
  const [page, setPage] = useState(1);

  // 拉更多文章（用于词云/实体/媒体排行统计更稳健）
  const articles = useArticles(topic, timespan, 1000);
  const volume = useVolume(topic, timespan);
  const tone = useTone(topic, timespan);
  const country = useCountry(topic, timespan);

  const volData = volume.data?.timeline?.[0]?.data ?? [];
  const toneData = tone.data?.timeline?.[0]?.data ?? [];
  const arts: Article[] = articles.data?.articles ?? [];

  // 切换议题/时间窗时回到第一页
  useEffect(() => setPage(1), [topic, timespan]);

  // ---- 国家聚合：FIPS 代码 -> 中文名 + 地图英文名 ----
  const countrySeries = country.data?.timeline ?? [];
  // 按地图英文国名合并聚合：一个中国原则下，TW/HK/MC 均归入 China，
  // 因此排行与地图都应按 mapName 合并，避免台湾/香港独立成行。
  const countryAgg = useMemo(() => {
    const byMap = new Map<string, { mapName: string; zh: string; value: number }>();
    for (const s of countrySeries) {
      const code = s.series;
      const value = avg(s.data); // 绝对篇数
      if (!code || value <= 0) continue;
      const mapName = fipsToMapName(code) || code;
      const existing = byMap.get(mapName);
      if (existing) {
        existing.value += value;
        // 中国统一显示为「中国」（不被中国台湾/香港覆盖）
        if (mapName === "China") existing.zh = "中国";
      } else {
        byMap.set(mapName, {
          mapName,
          zh: mapName === "China" ? "中国" : fipsToZh(code),
          value,
        });
      }
    }
    return Array.from(byMap.values())
      .map((d) => ({ code: d.mapName, zh: d.zh, value: d.value }))
      .sort((a, b) => b.value - a.value);
  }, [countrySeries]);

  // 地图：key=地图英文国名, value=篇数（countryAgg.code 已是 mapName）
  const countryMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of countryAgg) {
      if (d.code) m[d.code] = (m[d.code] ?? 0) + d.value;
    }
    return m;
  }, [countryAgg]);
  // 地图英文名 -> 中文名（悬浮提示）
  const zhNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const d of countryAgg) {
      if (d.code) m[d.code] = d.zh;
    }
    return m;
  }, [countryAgg]);

  const totalCountryArts = useMemo(
    () => countryAgg.reduce((s, d) => s + d.value, 0),
    [countryAgg],
  );

  // ---- 派生统计：媒体排行 / 词云 / 实体 ----
  const outletRank = useMemo(() => buildOutletRanking(arts, 12), [arts]);
  const wordCloud = useMemo(() => buildWordCloud(arts, 55), [arts]);
  const entities = useMemo(() => buildEntities(arts, 18), [arts]);

  // ---- 报道流分页 ----
  const pageCount = Math.max(1, Math.ceil(arts.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageArts = arts.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // ---- KPI 值 ----
  const latestVol = volData.at(-1)?.value ?? 0;
  const prevVol = volData.at(-2)?.value ?? latestVol;
  const volDelta = latestVol - prevVol;
  const avgTone = avg(toneData);
  const topCountry = countryAgg[0]?.zh ?? "—";
  const langCount = new Set(arts.map((a) => a.language).filter(Boolean)).size;
  const activeTopic = TOPICS.find((t) => t.key === topic);
  const timespanLabel = TIMESPANS.find((t) => t.value === timespan)?.label ?? timespan;

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
              <a
                href="https://climate.newsfindsme.com/"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-muted-foreground transition-colors hover:text-primary"
              >
                ZJU-CMIC Program on Climate and Science Communication
              </a>
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
            数据接口短暂限流，系统正在自动重试，数据将在入库后自动刷新。
          </div>
        )}

        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi
            icon={Newspaper} label="报道总量" value={`${arts.length}`}
            unit="篇"
            hint={`${timespanLabel} · ${activeTopic?.label ?? ""}`} accent="chart-1"
            info={`所选议题与时间窗内入库的文章绝对数量（去重后按 URL 计）。数据库每 15 分钟持续累积，无上限；此处为单次展示读取，上限 1000 篇。`}
          />
          <Kpi
            icon={TrendingUp} label="报道强度" value={`${latestVol.toFixed(2)}%`}
            hint="占全球新闻比例" accent="chart-2" delta={volDelta}
            info={`GDELT TimelineVol 指标：该议题报道量占同时段全球所有监测新闻的百分比，反映「相对热度」。箭头为相对上一时间桶的变化。`}
          />
          <Kpi
            icon={Smile} label="平均情感倾向" value={avgTone.toFixed(2)}
            hint={avgTone >= 0 ? "整体偏正面" : "整体偏负面"}
            accent={avgTone >= 0 ? "chart-3" : "chart-5"}
            info={`GDELT V1.5 Tone 的时段均值：正值偏正面、负值偏负面，0 为中性。基于文章正负情感词比例计算，范围约 -10 ~ +10。`}
          />
          <Kpi
            icon={Globe2} label="报道最多的报道国" value={topCountry}
            hint="发布媒体所在国" accent="chart-6"
            info={`报道国 = 发布该新闻的媒体所在国家（GDELT sourcecountry，FIPS 代码已转中文）。注意：这不是新闻「事件发生地」，而是「谁在报道」。`}
          />
        </div>

        {/* Trend charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Panel
            icon={Activity} title="报道量趋势" sub="% of global coverage"
            className="lg:col-span-2"
            info="折线为该议题报道量占全球新闻的百分比随时间变化（GDELT TimelineVol）。反映相对热度走势，而非绝对篇数。"
          >
            <div className="h-64 p-4">
              {volume.isLoading ? <ChartSkeleton /> :
                volData.length === 0 ? <EmptyChart label="暂无趋势数据" /> :
                <VolumeChart data={volData} />}
            </div>
          </Panel>
          <Panel
            icon={Smile} title="情感趋势" sub="avg tone"
            info="每个时间桶内所有相关报道的平均情感值（GDELT Tone）随时间变化。0 线以上偏正面，以下偏负面。"
          >
            <div className="h-64 p-4">
              {tone.isLoading ? <ChartSkeleton /> :
                toneData.length === 0 ? <EmptyChart label="暂无情感数据" /> :
                <ToneChart data={toneData} />}
            </div>
          </Panel>
        </div>

        {/* Map + ranking */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Panel
            icon={MapPin} title="全球报道热力图" sub={`报道国 · 共 ${totalCountryArts} 篇`}
            className="lg:col-span-2"
            info="按「报道国」（发布新闻的媒体所在国）的报道篇数着色：颜色越偏橙红，该国媒体在此议题上的报道越多。代表「哪些国家的媒体在关注」，非事件发生地。悬浮可看具体篇数。"
          >
            <div className="h-[330px] p-2">
              {country.isLoading ? <ChartSkeleton /> :
                Object.keys(countryMap).length === 0 ? <EmptyChart label="暂无地区数据" /> :
                <WorldMap byCountry={countryMap} zhNames={zhNames} />}
            </div>
            <p className="px-4 pb-3 text-[11px] leading-snug text-muted-foreground">
              说明：台湾、香港、澳门及南海诸岛均为中华人民共和国领土不可分割的一部分，地图着色与统计均已合并入中国。
            </p>
          </Panel>
          <Panel
            icon={Globe2} title="报道国排行" sub="Top 12"
            info="发布报道最多的国家（按媒体所在国 sourcecountry 统计的绝对篇数）。"
          >
            <div className="h-[360px] p-3">
              {country.isLoading ? <ChartSkeleton /> :
                countryAgg.length === 0 ? <EmptyChart label="暂无地区数据" /> :
                <CountryBar data={countryAgg.slice(0, 12).map((d) => ({ country: d.zh, value: d.value }))} unit="篇" />}
            </div>
          </Panel>
        </div>

        {/* Outlet ranking + Entities */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Panel
            icon={Building2} title="媒体来源排行" sub={`Top ${outletRank.length}`}
            info="按发布该议题报道的媒体（域名）统计的文章数量排行，反映哪些媒体最活跃。基于当前样本（单次读取上限 1000 篇）。"
          >
            <div className="h-[320px] p-4">
              {articles.isLoading ? <ChartSkeleton /> :
                <HBarRank items={outletRank.map((o) => ({ label: o.label, count: o.count }))} unit="篇" />}
            </div>
          </Panel>
          <Panel
            icon={Tags} title="高频实体提及" sub="标题 / 导语"
            info="从报道标题与导语中近似提取的命名实体（机构、人物、地点、专有名词），按被多少篇报道提及排序。基于大写词组启发式识别，至少 2 篇提及才计入。"
          >
            <div className="h-[320px] p-4">
              {articles.isLoading ? <ChartSkeleton /> :
                <HBarRank items={entities.map((e) => ({ label: e.text, count: e.count }))} unit="篇" />}
            </div>
          </Panel>
        </div>

        {/* Word cloud */}
        <Panel
          icon={Cloud} title="报道关键词词云" sub="标题加权 ×2"
          info="对标题（权重 2）与导语（权重 1）分词后去停用词的高频词。字号越大、颜色越深表示出现越多。中英文混合统计。"
        >
          <div className="h-[280px] p-3">
            {articles.isLoading ? <ChartSkeleton /> : <WordCloud terms={wordCloud} />}
          </div>
        </Panel>

        {/* Article feed (paginated) */}
        <Panel
          icon={Newspaper} title="最新报道流"
          sub={`共 ${arts.length} 篇 · 第 ${safePage}/${pageCount} 页`}
          info="所选议题与时间窗内的全部入库报道，按发布时间倒序。每页 12 篇，使用下方翻页浏览。"
        >
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
              <>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {pageArts.map((a, i) => (
                    <ArticleCard key={a.url + i} a={a} />
                  ))}
                </div>
                <Pager
                  page={safePage}
                  pageCount={pageCount}
                  onChange={(p) => {
                    setPage(p);
                    if (typeof window !== "undefined")
                      window.scrollTo({ top: window.scrollY, behavior: "auto" });
                  }}
                />
              </>
            )}
          </div>
        </Panel>

        {/* 数据来源与致谢说明 */}
        <Panel icon={Heart} title="数据来源与致谢" sub="Acknowledgments">
          <div className="space-y-5 p-5 text-sm leading-relaxed text-muted-foreground">
            <p>
              本看板的全部新闻数据由
              {" "}
              <a
                href="https://www.gdeltproject.org/"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-primary underline-offset-2 hover:underline"
              >
                The GDELT Project（全球事件、语言与语调数据库）
              </a>
              {" "}
              提供。GDELT 是一个开放的全球新闻监测与计算社会科学项目，实时监测全球几乎所有国家、上百种语言的广播、印刷与网络新闻，并将其整理为结构化的开放数据。我们对 GDELT 团队长期免费开放高质量数据、支持全球学术与公共研究的努力表示诚挚感谢。
            </p>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2">
              <AckCard
                icon={Database}
                title="GKG · 全球知识图谱"
                body="GDELT Global Knowledge Graph 从每篇新闻中抽取人物、机构、地点、主题与情感等实体信息。本看板的入库管线每 15 分钟解析 GKG 原始文件，提取气候议题相关报道。"
              />
              <AckCard
                icon={Activity}
                title="DOC 2.0 API"
                body="GDELT DOC 2.0 文档检索接口提供文章列表与报道量、情感时间线。其单次请求最多返回 250 条，是接口本身的官方上限。"
              />
              <AckCard
                icon={Clock}
                title="持续累积，并非 250 篇上限"
                body="数据库每 15 分钟自动入库新报道并长期持续累积，没有总量限制。看板中的「250 / 1000」只是单次请求或前端展示读取的条数上限，用于词云、实体与媒体排行等客户端统计，并不限制底层数据积累。"
              />
              <AckCard
                icon={Scale}
                title="开放授权"
                body="GDELT 全部数据集对学术、商业与政府用途免费开放、不受限制使用。按其授权要求，任何使用或再分发都须注明 GDELT Project 并链接至其官网，本看板已遵循此要求。"
              />
            </div>

            <p className="text-xs">
              数据持久化于
              {" "}
              <a
                href="https://supabase.com/"
                target="_blank"
                rel="noreferrer"
                className="text-primary underline-offset-2 hover:underline"
              >
                Supabase
              </a>
              （PostgreSQL）。世界地图底图来自
              {" "}
              <a
                href="https://github.com/topojson/world-atlas"
                target="_blank"
                rel="noreferrer"
                className="text-primary underline-offset-2 hover:underline"
              >
                world-atlas（Natural Earth 公有领域数据）
              </a>
              。在此一并向所有开源数据与工具的维护者致谢。
            </p>
          </div>
        </Panel>

        <footer className="space-y-1.5 pt-2 pb-8 text-center text-xs text-muted-foreground">
          <p>
            数据来源：
            <a href="https://www.gdeltproject.org/" target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
              The GDELT Project
            </a>
            {" · "}GKG / DOC 2.0（每 15 分钟入库 · 覆盖最近 3 个月）· 数据持久化于 Supabase。
          </p>
          <p>
            © {new Date().getFullYear()}{" "}
            <a
              href="https://climate.newsfindsme.com/"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              ZJU-CMIC Program on Climate and Science Communication
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}

function Kpi({
  icon: Icon, label, value, unit, hint, accent, delta, info,
}: {
  icon: any; label: string; value: string; unit?: string; hint: string;
  accent: string; delta?: number; info?: string;
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
        {info && <InfoTip text={info} />}
      </div>
      <div className="mt-2.5 flex items-end gap-2">
        <div className="font-display text-2xl font-bold leading-none num truncate" data-testid={`kpi-${label}`}>
          {value}
          {unit && <span className="ml-1 text-sm font-semibold text-muted-foreground">{unit}</span>}
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
  const img = a.socialimage || a.top_image || "";
  return (
    <a
      href={a.url}
      target="_blank"
      rel="noreferrer"
      data-testid="card-article"
      className="group flex flex-col overflow-hidden rounded-xl border border-card-border bg-card transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
    >
      {img ? (
        <div className="relative h-28 overflow-hidden bg-muted">
          <img
            src={img}
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
          {decodeEntities(a.title)}
        </p>
        <div className="mt-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="max-w-[7rem] truncate font-medium">{a.outlet || a.domain}</span>
          <span className="text-card-border">·</span>
          <span className="max-w-[5rem] truncate">{fipsToZh(a.sourcecountry)}</span>
          <ExternalLink className="ml-auto size-3 opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
        <div className="num text-xs text-muted-foreground">{relTime(a.seendate)}</div>
      </div>
    </a>
  );
}

function AckCard({
  icon: Icon, title, body,
}: {
  icon: any; title: string; body: string;
}) {
  return (
    <div className="flex gap-3 rounded-xl border border-card-border bg-card/60 p-3.5">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
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
