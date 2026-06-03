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

// 后端限流时返回 429；这里自动重试
const liveOpts = {
  refetchInterval: 120_000,
  staleTime: 60_000,
  retry: 3,
  retryDelay: 6500,
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

// ---- 时间工具 ------------------------------------------------------
export function parseGdeltDate(s: string): Date {
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
