import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./queryClient";

export type Topic = { key: string; label: string };

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

async function getJson<T>(url: string): Promise<T> {
  const res = await apiRequest("GET", url);
  return res.json();
}

function qs(topic: string, timespan: string, extra: Record<string, string> = {}) {
  return "?" + new URLSearchParams({ topic, timespan, ...extra }).toString();
}

// 自动重试限流的查询配置（GDELT 限流时后端返回 429）
const liveOpts = {
  refetchInterval: 90_000, // 与 15 分钟更新节奏相符，保持「实时」感
  staleTime: 60_000,
  retry: 2,
  retryDelay: 6000, // 限流后等待 >5s 再试
};

export function useTopics() {
  return useQuery<Topic[]>({
    queryKey: ["/api/topics"],
    queryFn: () => getJson("/api/topics"),
    staleTime: Infinity,
  });
}

export function useArticles(topic: string, timespan: string, max = 60) {
  return useQuery({
    queryKey: ["/api/articles", topic, timespan, max],
    queryFn: () => getJson<{ articles?: Article[] }>(`/api/articles${qs(topic, timespan, { max: String(max) })}`),
    ...liveOpts,
  });
}

interface TimelineResp {
  timeline?: { series: string; data: TimelinePoint[] }[];
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

// 工具：GDELT 时间格式 20260603T083000Z -> Date
export function parseGdeltDate(s: string): Date {
  // 兼容 20260603T083000Z 和 20260603083000
  const m = s.replace("T", "").replace("Z", "");
  const y = +m.slice(0, 4),
    mo = +m.slice(4, 6) - 1,
    d = +m.slice(6, 8),
    h = +m.slice(8, 10) || 0,
    mi = +m.slice(10, 12) || 0;
  return new Date(Date.UTC(y, mo, d, h, mi));
}

export function fmtTime(s: string): string {
  const d = parseGdeltDate(s);
  return d.toLocaleString("zh-CN", {
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
