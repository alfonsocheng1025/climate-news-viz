import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./queryClient";

/**
 * 数据获取层
 * ------------------------------------------------------------
 * 方案 B（当前）：调用本站后端代理（Express），由后端转发 GDELT DOC 2.0 API。
 *   为什么必须走后端：GDELT 的响应（尤其限流文本）不带 CORS 头，浏览器
 *   直连会被拦截。后端代理同时负责：5 秒限流串行队列 + 内存缓存。
 *
 * 切换到方案 A（自建 Supabase 库）时：只需替换后端 server/gdelt.ts 里的
 *   数据源实现，本文件与组件层无需改动。
 */

export const TOPICS = [
  { key: "all", label: "全部气候议题" },
  { key: "climate_change", label: "气候变化 / 全球变暖" },
  { key: "extreme_weather", label: "极端天气 / 灾害" },
  { key: "renewable_energy", label: "可再生能源" },
  { key: "carbon_policy", label: "碳排放 / 政策" },
];

export const TIMESPANS = [
  { value: "3h", label: "近 3 小时" },
  { value: "12h", label: "近 12 小时" },
  { value: "1d", label: "近 24 小时" },
  { value: "3d", label: "近 3 天" },
  { value: "7d", label: "近 7 天" },
  { value: "1m", label: "近 1 个月" },
];

export interface Article {
  url: string;
  url_mobile: string;
  title: string;
  seendate: string;
  socialimage: string;
  domain: string;
  language: string;
  sourcecountry: string;
  // 全文字段（方案 A / Supabase 入库后才有）
  outlet?: string | null;
  authors?: string[] | null;
  published_at?: string | null;
  lede?: string | null;
  body?: string | null;
  top_image?: string | null;
}

export interface TimelinePoint {
  date: string;
  value: number;
}

interface TimelineResp {
  timeline?: { series: string; data: TimelinePoint[] }[];
}

async function getJson<T>(url: string): Promise<T> {
  const res = await apiRequest("GET", url);
  return res.json();
}

function qs(topic: string, timespan: string, extra: Record<string, string> = {}) {
  return "?" + new URLSearchParams({ topic, timespan, ...extra }).toString();
}

// 后端已内置 5 秒串行队列 + 限流冷却 + 过期缓存兜底。
// 因此前端不做激进重试（避免在冷却期重试雪崩），仅靠定时轮询自愈：
// 后端冷却结束后，下一轮 120 秒刷新即可取回最新数据。
const liveOpts = {
  refetchInterval: 120_000,
  staleTime: 60_000,
  retry: 1,
  retryDelay: 8000,
};

export function useArticles(topic: string, timespan: string, max = 60) {
  return useQuery({
    queryKey: ["/api/articles", topic, timespan, max],
    queryFn: () =>
      getJson<{ articles?: Article[] }>(
        `/api/articles${qs(topic, timespan, { max: String(max) })}`,
      ),
    ...liveOpts,
  });
}

export function useVolume(topic: string, timespan: string) {
  return useQuery({
    queryKey: ["/api/timeline/volume", topic, timespan],
    queryFn: () => getJson<TimelineResp>(`/api/timeline/volume${qs(topic, timespan)}`),
    ...liveOpts,
  });
}

export function useTone(topic: string, timespan: string) {
  return useQuery({
    queryKey: ["/api/timeline/tone", topic, timespan],
    queryFn: () => getJson<TimelineResp>(`/api/timeline/tone${qs(topic, timespan)}`),
    ...liveOpts,
  });
}

export function useCountry(topic: string, timespan: string) {
  return useQuery({
    queryKey: ["/api/timeline/country", topic, timespan],
    queryFn: () => getJson<TimelineResp>(`/api/timeline/country${qs(topic, timespan)}`),
    ...liveOpts,
  });
}

/* ------------------------------------------------------------------ */
/* 全量聚合类 hooks（服务端聚合，不受单次读取上限影响）           */
/* ------------------------------------------------------------------ */

// 报道总量（全部入库）
export function useTotal(topic: string, timespan: string) {
  return useQuery({
    queryKey: ["/api/total", topic, timespan],
    queryFn: () => getJson<{ total: number }>(`/api/total${qs(topic, timespan)}`),
    ...liveOpts,
  });
}

export interface OutletItem {
  label: string;
  domain: string;
  count: number;
}
// 媒体来源排行（全量）
export function useOutlets(topic: string, timespan: string, limit = 12) {
  return useQuery({
    queryKey: ["/api/outlets", topic, timespan, limit],
    queryFn: () =>
      getJson<{ outlets: OutletItem[] }>(
        `/api/outlets${qs(topic, timespan, { limit: String(limit) })}`,
      ),
    ...liveOpts,
  });
}

export interface LangItem {
  code: string;
  count: number;
}
// 语言分布（全量）
export function useLanguages(topic: string, timespan: string) {
  return useQuery({
    queryKey: ["/api/languages", topic, timespan],
    queryFn: () => getJson<{ languages: LangItem[] }>(`/api/languages${qs(topic, timespan)}`),
    ...liveOpts,
  });
}

// 报道流搜索 + 分页（全量；空关键词 = 全部报道流）
export function useSearch(
  topic: string,
  timespan: string,
  q: string,
  limit: number,
  offset: number,
) {
  return useQuery({
    queryKey: ["/api/search", topic, timespan, q, limit, offset],
    queryFn: () =>
      getJson<{ articles: Article[]; total: number }>(
        `/api/search${qs(topic, timespan, {
          q,
          limit: String(limit),
          offset: String(offset),
        })}`,
      ),
    ...liveOpts,
    placeholderData: (prev) => prev, // 翻页/输入时保留上一页，避免闪烁
  });
}

/* ---- ISO 639-3 语言代码 -> 中文名 ---------------------------------- */
const LANG_ZH: Record<string, string> = {
  eng: "英语", zho: "中文", spa: "西班牙语", deu: "德语", fra: "法语",
  ita: "意大利语", por: "葡萄牙语", rus: "俄语", jpn: "日语", kor: "韩语",
  ara: "阿拉伯语", ben: "孟加拉语", hin: "印地语", ind: "印尼语", tur: "土耳其语",
  nld: "荷兰语", pol: "波兰语", swe: "瑞典语", ces: "捷克语", ell: "希腊语",
  bul: "保加利亚语", hrv: "克罗地亚语", srp: "塞尔维亚语", ukr: "乌克兰语", ron: "罗马尼亚语",
  cat: "加泰罗尼亚语", lav: "拉脱维亚语", lit: "立陶宛语", sqi: "阿尔巴尼亚语", slk: "斯洛伐克语",
  fin: "芬兰语", dan: "丹麦语", nor: "挪威语", hun: "匈牙利语", tha: "泰语",
  vie: "越南语", fas: "波斯语", heb: "希伯来语", urd: "乌尔都语", msa: "马来语",
  unknown: "未知 / 未标记",
};
export function langZh(code: string): string {
  return LANG_ZH[code] || code.toUpperCase();
}

// ---- 时间工具 ------------------------------------------------------
export function parseGdeltDate(s: string): Date {
  if (!s) return new Date(NaN);
  // 方案 A（Supabase）返回标准 ISO8601 / timestamptz；方案 B（GDELT 直连）返回紧凑格式。
  // 同时兼容两者：含 "-" 或 ":" 视为 ISO，交给原生解析。
  if (s.includes("-") || s.includes(":")) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
  }
  const m = s.replace("T", "").replace("Z", "");
  const y = +m.slice(0, 4),
    mo = +m.slice(4, 6) - 1,
    d = +m.slice(6, 8),
    h = +m.slice(8, 10) || 0,
    mi = +m.slice(10, 12) || 0;
  return new Date(Date.UTC(y, mo, d, h, mi));
}

export function fmtTime(s: string): string {
  return parseGdeltDate(s).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function relTime(s: string): string {
  const diff = Date.now() - parseGdeltDate(s).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}
