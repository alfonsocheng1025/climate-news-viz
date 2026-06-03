import type { Express } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { dataSource, TOPIC_PRESETS } from "./gdelt";

const VALID_TIMESPANS = new Set([
  "15min", "30min", "1h", "3h", "6h", "12h",
  "1d", "2d", "3d", "7d", "1w", "2w", "1m", "3m",
]);

function clean(timespan: unknown): string {
  const t = String(timespan ?? "1d");
  return VALID_TIMESPANS.has(t) ? t : "1d";
}
function cleanTopic(topic: unknown): string {
  const t = String(topic ?? "all");
  return TOPIC_PRESETS[t] ? t : "all";
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  // 可用议题预设（前端筛选器用）
  app.get("/api/topics", (_req, res) => {
    res.json(
      Object.entries(TOPIC_PRESETS).map(([key, v]) => ({ key, label: v.label })),
    );
  });

  const wrap =
    (fn: (topic: string, timespan: string, max: number) => Promise<any>) =>
    async (req: any, res: any) => {
      try {
        const topic = cleanTopic(req.query.topic);
        const timespan = clean(req.query.timespan);
        const max = Math.min(Number(req.query.max) || 75, 250);
        const data = await fn(topic, timespan, max);
        res.json(data);
      } catch (e: any) {
        const rate = e?.message === "GDELT_RATE_LIMITED";
        res.status(rate ? 429 : 502).json({
          error: rate ? "rate_limited" : "upstream_error",
          message: rate
            ? "GDELT 接口限流，请稍候自动重试"
            : "无法从 GDELT 获取数据",
        });
      }
    };

  app.get("/api/articles", wrap((t, ts, m) => dataSource.articles(t, ts, m)));
  app.get("/api/timeline/volume", wrap((t, ts) => dataSource.timelineVolume(t, ts)));
  app.get("/api/timeline/tone", wrap((t, ts) => dataSource.timelineTone(t, ts)));
  app.get("/api/timeline/country", wrap((t, ts) => dataSource.timelineCountry(t, ts)));
  app.get("/api/timeline/lang", wrap((t, ts) => dataSource.timelineLang(t, ts)));
  app.get("/api/geo", wrap((t, ts) => dataSource.geo(t, ts)));

  return httpServer;
}
