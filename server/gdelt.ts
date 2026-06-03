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

// ---- 请求队列 + 限流（每 6 秒最多 1 次外呼） ------------------------
// GDELT 官方限制「每 5 秒一次」。一旦被判定超限会进入更严格的惩罚期，
// 期间即便间隔合规也会持续返回 429。因此这里：
//   1) 基础间隔提到 6 秒，留出余量；
//   2) 一旦收到限流信号，进入 90 秒全局冷却，期间所有外呼直接跳过
//      （改由上层的过期缓存兜底），避免重试雪崩不断刷新惩罚计时。
const MIN_INTERVAL_MS = 6000;
const COOLDOWN_MS = 90_000;
let lastCall = 0;
let cooldownUntil = 0;
let chain: Promise<unknown> = Promise.resolve();

export function enterCooldown() {
  cooldownUntil = Date.now() + COOLDOWN_MS;
}
export function inCooldown() {
  return Date.now() < cooldownUntil;
}

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

// ---- 内存缓存（含过期兜底） ------------------------------------
type CacheEntry = { ts: number; data: unknown };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000; // 1 分钟，匹配 GDELT 15 分钟更新节奏下的合理新鲜度

async function cachedFetch(url: string, ttl = TTL_MS): Promise<any> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.ts < ttl) return hit.data;

  // 冷却期间不再外呼：有过期缓存则直接返回旧数据，否则报限流
  if (inCooldown()) {
    if (hit) return hit.data;
    throw new Error("GDELT_RATE_LIMITED");
  }

  try {
    const data = await enqueue(async () => {
      const res = await fetch(url, { headers: { "User-Agent": "climate-news-viz/1.0" } });
      const text = await res.text();
      const trimmed = text.trim();
      // GDELT 限流时返回纯文本提示而非 JSON
      if (trimmed.startsWith("Please limit")) {
        enterCooldown();
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
  } catch (e: any) {
    // 限流或上游错误时，若有过期旧数据则兜底返回，保证页面始终有内容
    if (hit && e?.message === "GDELT_RATE_LIMITED") return hit.data;
    throw e;
  }
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
  // 全量聚合（不受单次读取上限影响）
  totalCount(topic: string, timespan: string): Promise<any>;
  outlets(topic: string, timespan: string, limit: number): Promise<any>;
  languages(topic: string, timespan: string): Promise<any>;
  search(topic: string, timespan: string, q: string, limit: number, offset: number): Promise<any>;
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
  // 方案 B（实时代理）下的全量聚合：GDELT 无对应直出接口，返回占位。
  // 仅在回退到 GdeltLiveSource 时生效；当前生产走方案 A。
  async totalCount(_topic: string, _timespan: string) {
    return { total: 0 };
  }
  async outlets(_topic: string, _timespan: string, _limit: number) {
    return { outlets: [] };
  }
  async languages(_topic: string, _timespan: string) {
    return { languages: [] };
  }
  async search(_topic: string, _timespan: string, _q: string, _limit: number, _offset: number) {
    return { articles: [], total: 0 };
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

// ---- timespan -> 小时数（供查库用） -------------------------------
export function timespanToHours(ts: string): number {
  const m = ts.match(/^(\d+)(min|h|d|w|m)$/);
  if (!m) return 24;
  const n = +m[1];
  switch (m[2]) {
    case "min": return Math.max(1, Math.ceil(n / 60));
    case "h": return n;
    case "d": return n * 24;
    case "w": return n * 24 * 7;
    case "m": return n * 24 * 30;
    default: return 24;
  }
}

// ====================================================================
// 方案 A：查询自建 Supabase 库（通过只读 RPC，anon 密钥）
// 接口与 GdeltLiveSource 完全一致，路由层 / 前端无需改动。
// 返回结构也保持与 GDELT 一致（{articles:[]} / {timeline:[{series,data:[{date,value}]}]}）。
// ====================================================================
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

// 不用 supabase-js（其 realtime 客户端在 Node 20 下缺 WebSocket 会报错），
// 直接用 fetch 调 PostgREST 的 RPC 端点，轻量且无额外依赖。
async function rpc<T = any>(fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`SUPABASE_ERROR: ${res.status} ${txt.slice(0, 160)}`);
  }
  return res.json();
}

class SupabaseSource implements ClimateDataSource {
  async articles(topic: string, timespan: string, max: number) {
    const data = await rpc<any[]>("climate_articles", {
      p_topic: topic,
      p_hours: timespanToHours(timespan),
      p_max: Math.min(max, 1000),
    });
    return { articles: data ?? [] };
  }

  private async timeline(topic: string, series: "volume" | "tone", timespan: string) {
    const data = await rpc<any[]>("climate_timeline", {
      p_topic: topic,
      p_series: series,
      p_hours: timespanToHours(timespan),
    });
    // 转成 GDELT 风格：{timeline:[{series,data:[{date,value}]}]}
    const points = (data ?? []).map((r: any) => ({
      date: r.bucket_time,
      value: r.value,
    }));
    return { timeline: [{ series, data: points }] };
  }

  timelineVolume(topic: string, timespan: string) {
    return this.timeline(topic, "volume", timespan);
  }
  timelineTone(topic: string, timespan: string) {
    return this.timeline(topic, "tone", timespan);
  }

  async timelineCountry(topic: string, timespan: string) {
    const data = await rpc<any[]>("climate_countries", {
      p_topic: topic,
      p_hours: timespanToHours(timespan),
    });
    // 前端期望 {timeline:[{series:国家, data:[{date,value}]}]}，取均值即文章数
    const now = new Date().toISOString();
    const timeline = (data ?? []).map((r: any) => ({
      series: r.sourcecountry,
      data: [{ date: now, value: Number(r.cnt) }],
    }));
    return { timeline };
  }

  async timelineLang(topic: string, timespan: string) {
    // 语言维度暂从 articles 派生（前端主用 articles 统计语种数）
    return { timeline: [] };
  }

  // 全量报道总量（不受读取上限影响）
  async totalCount(topic: string, timespan: string) {
    const total = await rpc<number>("climate_total_count", {
      p_topic: topic,
      p_hours: timespanToHours(timespan),
    });
    return { total: Number(total) || 0 };
  }

  // 全量媒体（域名）排行
  async outlets(topic: string, timespan: string, limit: number) {
    const data = await rpc<any[]>("climate_outlets", {
      p_topic: topic,
      p_hours: timespanToHours(timespan),
      p_limit: limit,
    });
    return {
      outlets: (data ?? []).map((r: any) => ({
        label: r.outlet || r.domain,
        domain: r.domain,
        count: Number(r.cnt),
      })),
    };
  }

  // 全量语言分布
  async languages(topic: string, timespan: string) {
    const data = await rpc<any[]>("climate_languages", {
      p_topic: topic,
      p_hours: timespanToHours(timespan),
    });
    return {
      languages: (data ?? []).map((r: any) => ({
        code: r.language,
        count: Number(r.cnt),
      })),
    };
  }

  // 全量搜索 + 分页（空关键词 = 全部报道流）
  async search(topic: string, timespan: string, q: string, limit: number, offset: number) {
    const data = await rpc<any[]>("climate_search", {
      p_topic: topic,
      p_hours: timespanToHours(timespan),
      p_q: q || "",
      p_limit: limit,
      p_offset: offset,
    });
    const rows = data ?? [];
    const total = rows.length ? Number(rows[0].total) : 0;
    return { articles: rows.map((r: any) => r.rows), total };
  }

  async geo(topic: string, timespan: string) {
    // 地图由 timelineCountry 驱动，这里返回空 GeoJSON 占位
    return { type: "FeatureCollection", features: [] };
  }
}

// 当前使用方案 A（查自建 Supabase 库）。
// 如需回退到方案 B（实时代理 GDELT），换成 new GdeltLiveSource() 即可。
export const dataSource: ClimateDataSource = new SupabaseSource();
