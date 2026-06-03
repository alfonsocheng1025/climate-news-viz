/**
 * GDELT 数据源抽象层 (Data Source Abstraction)
 * ------------------------------------------------------------
 * 当前实现：方案 B —— 实时代理 GDELT DOC 2.0 / GEO 2.0 API。
 * 未来切换到方案 A（查询自己的 Supabase 库）时，只需新增一个实现
 * 相同 ClimateDataSource 接口的类，路由层与前端无需改动。
 *
 * 关键设计：
 *  1. 全局请求队列 —— GDELT 限制「每 5 秒一次请求」，这里串行化所有
 *     外呼并强制 >=5s 间隔，前端可任意并发而不会触发限流。
 *  2. 内存缓存 —— 相同查询在 TTL 内直接返回，进一步降低外呼次数。
 */

const DOC_API = "https://api.gdeltproject.org/api/v2/doc/doc";
const GEO_API = "https://api.gdeltproject.org/api/v2/geo/geo";

// ---- 气候主题/关键词过滤规则（可配置） -------------------------------
// GKG 主题代码比纯关键词更稳健（跨 65 种语言归一化）。
export const CLIMATE_THEMES = [
  "ENV_CLIMATECHANGE",
  "ENV_CARBONCAPTURE",
  "ENV_GREEN",
  "ENV_SOLAR",
  "ENV_WINDPOWER",
  "NATURAL_DISASTER",
  "WB_567_CLIMATE_CHANGE",
  "WB_1462_WEATHER_EXTREMES",
];

export const CLIMATE_KEYWORDS = [
  "climate change",
  "global warming",
  "carbon emissions",
  "greenhouse gas",
  "气候变化",
  "全球变暖",
];

// 子主题预设：让前端可按议题切换 query
export const TOPIC_PRESETS: Record<string, { label: string; query: string }> = {
  all: {
    label: "全部气候议题",
    query: `(${CLIMATE_KEYWORDS.map((k) => (k.includes(" ") ? `"${k}"` : k)).join(" OR ")})`,
  },
  climate_change: {
    label: "气候变化 / 全球变暖",
    query: `("climate change" OR "global warming" OR "气候变化" OR "全球变暖") theme:ENV_CLIMATECHANGE`,
  },
  extreme_weather: {
    label: "极端天气 / 灾害",
    query: `("extreme weather" OR flood OR drought OR wildfire OR heatwave OR hurricane) theme:NATURAL_DISASTER`,
  },
  renewable_energy: {
    label: "可再生能源",
    query: `("renewable energy" OR "solar power" OR "wind power" OR "clean energy")`,
  },
  carbon_policy: {
    label: "碳排放 / 政策",
    query: `("carbon emissions" OR "carbon tax" OR "net zero" OR "emissions policy" OR COP30)`,
  },
};

// ---- 请求队列 + 限流（每 5 秒最多 1 次外呼） ------------------------
const MIN_INTERVAL_MS = 5200;
let lastCall = 0;
let chain: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastCall));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  // 保证链条不因单个错误中断
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run as Promise<T>;
}

// ---- 内存缓存 ------------------------------------------------------
type CacheEntry = { ts: number; data: unknown };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000; // 1 分钟，匹配 GDELT 15 分钟更新节奏下的合理新鲜度

async function cachedFetch(url: string, ttl = TTL_MS): Promise<any> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.ts < ttl) return hit.data;

  const data = await enqueue(async () => {
    const res = await fetch(url, { headers: { "User-Agent": "climate-news-viz/1.0" } });
    const text = await res.text();
    const trimmed = text.trim();
    // GDELT 限流时返回纯文本提示而非 JSON
    if (trimmed.startsWith("Please limit")) {
      throw new Error("GDELT_RATE_LIMITED");
    }
    // 其它纯文本错误（如查询过短）不应被缓存
    if (
      trimmed.startsWith("The specified") ||
      trimmed.startsWith("Your query") ||
      (!trimmed.startsWith("{") && !trimmed.startsWith("["))
    ) {
      throw new Error(`GDELT_QUERY_ERROR: ${trimmed.slice(0, 120)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("GDELT_PARSE_ERROR");
    }
  });
  cache.set(url, { ts: Date.now(), data });
  return data;
}

// 注意：GDELT 把查询串里的 '+' 当作字面量，会破坏带空格的短语匹配。
// 必须用 %20 编码空格 —— 因此手动拼接而非用 URLSearchParams。
function encodeParams(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
}

function buildDocUrl(params: Record<string, string>): string {
  return `${DOC_API}?${encodeParams(params)}`;
}

// ---- 数据源接口 ----------------------------------------------------
export interface ClimateDataSource {
  articles(topic: string, timespan: string, max: number): Promise<any>;
  timelineVolume(topic: string, timespan: string): Promise<any>;
  timelineTone(topic: string, timespan: string): Promise<any>;
  timelineCountry(topic: string, timespan: string): Promise<any>;
  timelineLang(topic: string, timespan: string): Promise<any>;
  geo(topic: string, timespan: string): Promise<any>;
}

function resolveQuery(topic: string): string {
  return (TOPIC_PRESETS[topic] ?? TOPIC_PRESETS.all).query;
}

// 方案 B：实时代理 GDELT
class GdeltLiveSource implements ClimateDataSource {
  articles(topic: string, timespan: string, max: number) {
    return cachedFetch(
      buildDocUrl({
        query: resolveQuery(topic),
        mode: "ArtList",
        maxrecords: String(Math.min(max, 250)),
        timespan,
        format: "json",
        sort: "DateDesc",
      }),
    );
  }
  timelineVolume(topic: string, timespan: string) {
    return cachedFetch(
      buildDocUrl({ query: resolveQuery(topic), mode: "TimelineVol", timespan, format: "json" }),
    );
  }
  timelineTone(topic: string, timespan: string) {
    return cachedFetch(
      buildDocUrl({ query: resolveQuery(topic), mode: "TimelineTone", timespan, format: "json" }),
    );
  }
  timelineCountry(topic: string, timespan: string) {
    return cachedFetch(
      buildDocUrl({ query: resolveQuery(topic), mode: "TimelineSourceCountry", timespan, format: "json" }),
    );
  }
  timelineLang(topic: string, timespan: string) {
    return cachedFetch(
      buildDocUrl({ query: resolveQuery(topic), mode: "TimelineLang", timespan, format: "json" }),
    );
  }
  geo(topic: string, timespan: string) {
    const url = `${GEO_API}?${encodeParams({
      query: resolveQuery(topic),
      mode: "PointData",
      format: "GeoJSON",
      timespan,
    })}`;
    return cachedFetch(url, 120_000);
  }
}

export const dataSource: ClimateDataSource = new GdeltLiveSource();
