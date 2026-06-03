#!/usr/bin/env python3
"""
GDELT 抓取脚本（方案 A 入库用）
------------------------------------------------------------
从 GDELT DOC 2.0 抓取 5 个气候主题的文章 + 时间序列（volume/tone），
解析后写到 /tmp/gdelt_payload.json。

设计要点：
  - 串行 + 6 秒间隔，遵守 GDELT「每 5 秒 1 次」限流；
  - 一旦遇到「Please limit」限流文本，进入冷却并跳过剩余调用
    （本轮少抓一点，下一轮 15 分钟后补上，库里数据持续累积）；
  - 不抛错中断：单个主题失败不影响其它主题。

输出 JSON 结构：
  {
    "articles":  [ {url,title,...,topics:[...]}, ... ],   # 已按主题打标、按 url 去重
    "timeline":  [ {topic, series, points:[{date,value}]}, ... ]
  }
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

DOC_API = "https://api.gdeltproject.org/api/v2/doc/doc"

# 与前端 / 后端保持一致的 5 个主题
TOPIC_PRESETS = {
    "all": '("climate change" OR "global warming" OR "carbon emissions" OR "greenhouse gas" OR "气候变化" OR "全球变暖")',
    "climate_change": '("climate change" OR "global warming" OR "气候变化" OR "全球变暖") theme:ENV_CLIMATECHANGE',
    "extreme_weather": '("extreme weather" OR flood OR drought OR wildfire OR heatwave OR hurricane) theme:NATURAL_DISASTER',
    "renewable_energy": '("renewable energy" OR "solar power" OR "wind power" OR "clean energy")',
    "carbon_policy": '("carbon emissions" OR "carbon tax" OR "net zero" OR "emissions policy" OR COP30)',
}

MIN_INTERVAL = 6.0      # 秒，外呼最小间隔
TIMESPAN = "1d"         # 每轮抓近 24 小时，确保时间序列连续
MAX_RECORDS = 250       # 每主题最多取 250 条
TIMEOUT = 20

_last_call = [0.0]
_cooldown = [False]     # 命中限流后置为 True，跳过后续外呼


def _throttle():
    wait = MIN_INTERVAL - (time.time() - _last_call[0])
    if wait > 0:
        time.sleep(wait)
    _last_call[0] = time.time()


def gdelt(params: dict):
    """单次 GDELT 调用；限流返回 None 并进入冷却。"""
    if _cooldown[0]:
        return None
    _throttle()
    qs = "&".join(f"{k}={urllib.parse.quote(str(v))}" for k, v in params.items())
    url = f"{DOC_API}?{qs}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "climate-news-viz/1.0"})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            text = resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        # HTTP 429 = 限流，立即进入冷却，停止本轮后续外呼
        if e.code == 429:
            print("[warn] HTTP 429 rate-limited -> cooldown for this run", file=sys.stderr)
            _cooldown[0] = True
        else:
            print(f"[warn] http error {e.code}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"[warn] fetch failed: {e}", file=sys.stderr)
        return None
    t = text.strip()
    if t.startswith("Please limit"):
        print("[warn] GDELT rate-limited -> cooldown for this run", file=sys.stderr)
        _cooldown[0] = True
        return None
    if not (t.startswith("{") or t.startswith("[")):
        print(f"[warn] non-json: {t[:80]}", file=sys.stderr)
        return None
    try:
        return json.loads(text)
    except Exception:
        return None


def parse_seendate(s: str) -> str:
    """GDELT 20260603T083000Z -> ISO8601 用于 timestamptz"""
    s = s.replace("T", "").replace("Z", "")
    dt = datetime(int(s[0:4]), int(s[4:6]), int(s[6:8]),
                  int(s[8:10] or 0), int(s[10:12] or 0), tzinfo=timezone.utc)
    return dt.isoformat()


def main():
    articles_by_url = {}     # url -> row（topics 合并）
    timelines = []

    for topic, query in TOPIC_PRESETS.items():
        # 1) 文章列表
        art = gdelt({"query": query, "mode": "ArtList", "maxrecords": MAX_RECORDS,
                     "timespan": TIMESPAN, "format": "json", "sort": "DateDesc"})
        if art and isinstance(art.get("articles"), list):
            for a in art["articles"]:
                url = a.get("url")
                sd = a.get("seendate")
                if not url or not sd:
                    continue
                try:
                    iso = parse_seendate(sd)
                except Exception:
                    continue
                if url in articles_by_url:
                    if topic not in articles_by_url[url]["topics"]:
                        articles_by_url[url]["topics"].append(topic)
                else:
                    articles_by_url[url] = {
                        "url": url,
                        "title": a.get("title"),
                        "url_mobile": a.get("url_mobile"),
                        "socialimage": a.get("socialimage"),
                        "domain": a.get("domain"),
                        "language": a.get("language"),
                        "sourcecountry": a.get("sourcecountry"),
                        "seendate": iso,
                        "topics": [topic],
                    }

        # 2) 时间序列：volume + tone
        for mode, series in (("TimelineVol", "volume"), ("TimelineTone", "tone")):
            tl = gdelt({"query": query, "mode": mode, "timespan": TIMESPAN, "format": "json"})
            pts = []
            if tl and isinstance(tl.get("timeline"), list) and tl["timeline"]:
                for p in tl["timeline"][0].get("data", []):
                    d = p.get("date")
                    v = p.get("value")
                    if d is None or v is None:
                        continue
                    try:
                        pts.append({"date": parse_seendate(d), "value": float(v)})
                    except Exception:
                        continue
            if pts:
                timelines.append({"topic": topic, "series": series, "points": pts})

    payload = {
        "articles": list(articles_by_url.values()),
        "timeline": timelines,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "cooldown_hit": _cooldown[0],
    }
    out = "/tmp/gdelt_payload.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    print(f"articles={len(payload['articles'])} timelines={len(timelines)} "
          f"cooldown_hit={_cooldown[0]} -> {out}")


if __name__ == "__main__":
    main()
