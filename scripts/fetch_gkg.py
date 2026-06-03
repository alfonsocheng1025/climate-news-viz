#!/usr/bin/env python3
"""
GDELT GKG 批量文件抓取脚本（方案 A 入库用，替代 DOC 2.0）
============================================================
为什么换成 GKG 批文件：DOC 2.0 每轮要打 15 次 API（5 主题 × 3 端点），
沙盒 IP 触发「每 5 秒 1 次」的 per-IP 限流，整轮坍塌。GKG 批文件是
单个 zip 下载，没有 DOC API，彻底消除 per-IP 限流。

双数据源（GDELT 2.0 每 15 分钟两套）：
  - English GKG:     lastupdate.txt           -> *.gkg.csv.zip            (~5MB)
  - Translingual GKG: lastupdate-translation.txt -> *.translation.gkg.csv.zip (~15MB, 65+ 语种，
                      已机译为英文，主题码同为英文，故同一套列映射/主题码适用)

流程：
  1) 读两套 lastupdate，取各自最新 GKG zip URL；
  2) 幂等：文件名已处理过则跳过该源（记录在 tracking 目录）；
  3) 下载 + 解压 GKG CSV；
  4) 双重过滤（主题码 + 关键词）：
       a. 行的 V1Themes 分号切分后，须命中 4 个目标主题码之一（整词匹配，非子串）；
       b. 再要求该行与气候「相关关键词」吻合——强主题（气候变化/碳捕集）天然相关直接放行；
          噪声主题（NATURAL_DISASTER）须在标题或主题里出现气候/天气关键词，
          以剔除谋杀、爆炸、选举等被 GDELT 误打「灾害」标签的无关新闻。
  5) 构造 articles + 从命中行派生 timeline（volume 计数 + tone 均值），
     写到 /tmp/gdelt_payload.json（结构与 build_upsert_sql.py 期望一致）；
  6) 处理成功后把文件名写入 tracking，供下次幂等判断。

输出 JSON（复用 build_upsert_sql.py，不改）：
  {"articles":[{url,title,...,topics:[...]}], "timeline":[{topic,series,points:[{date,value}]}]}

退出码：
  0 = 成功（payload 已写；articles 可能为 0，表示本批无气候新闻，调用方静默结束）
  2 = 两套 GKG 文件都已处理过（幂等全跳过），调用方应静默结束、不入库
  3 = 抓取/解析全部失败（无可用数据）
"""
import csv
import io
import json
import os
import re
import sys
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime, timezone

TIMEOUT = 90
PAYLOAD_OUT = "/tmp/gdelt_payload.json"

# 两套数据源
SOURCES = [
    ("english", "http://data.gdeltproject.org/gdeltv2/lastupdate.txt", ".gkg.csv.zip"),
    ("translingual", "http://data.gdeltproject.org/gdeltv2/lastupdate-translation.txt",
     ".translation.gkg.csv.zip"),
]

# 跟踪目录：默认放工作区；cron 可用 GKG_TRACK_DIR 指向 cron_tracking/<id>/
TRACK_DIR = os.environ.get("GKG_TRACK_DIR", "/home/user/workspace/cron_tracking/gkg")
PROCESSED_FILE = os.path.join(TRACK_DIR, "processed_gkg.txt")

# 精确主题码 -> 前端已知的 topic key（climate.ts 中的 4 个键）
THEME_TO_TOPIC = {
    "ENV_CLIMATECHANGE": "climate_change",
    "WB_567_CLIMATE_CHANGE": "climate_change",
    "NATURAL_DISASTER": "extreme_weather",
    "ENV_CARBONCAPTURE": "carbon_policy",
}
TARGET_THEMES = set(THEME_TO_TOPIC)

# 强气候主题：命中即放行（主题码本身已足够特异，不再要求关键词）
STRONG_THEMES = {"ENV_CLIMATECHANGE", "WB_567_CLIMATE_CHANGE", "ENV_CARBONCAPTURE"}
# 噪声主题：须额外命中气候/天气关键词才放行
NOISY_THEMES = {"NATURAL_DISASTER"}

# ---- 气候相关关键词组（按主题归类，用于双重过滤）----
# 命中规则：标题（小写）或该行任一主题码（小写）包含其中任意关键词即视为相关。
CLIMATE_KEYWORDS = {
    # 气候变化 / 全球变暖 / 升温
    "climate_change": [
        "climate", "global warming", "warming", "greenhouse", "emission",
        "carbon", "co2", "ipcc", "cop30", "cop31", "paris agreement",
        "net zero", "decarbon", "fossil fuel", "气候", "全球变暖", "升温", "温室",
    ],
    # 极端天气 / 灾害（仅气候/天气相关，剔除谋杀爆炸选举等）
    "extreme_weather": [
        "flood", "flooding", "drought", "wildfire", "bushfire", "forest fire",
        "heatwave", "heat wave", "hurricane", "cyclone", "typhoon", "storm",
        "tornado", "rainfall", "downpour", "deluge", "landslide", "monsoon",
        "extreme weather", "heavy rain", "hailstorm", "blizzard", "sea level",
        "fire season", "dry spell", "torrential", "洪水", "干旱", "野火", "热浪",
        "台风", "飓风", "暴雨", "极端天气", "山火", "风暴",
    ],
    # 碳排放 / 碳捕集 / 政策
    "carbon_policy": [
        "carbon", "carbon capture", "ccs", "carbon tax", "emission", "net zero",
        "carbon neutral", "carbon market", "carbon credit", "sequestration",
        "decarbon", "climate policy", "emissions trading", "碳", "碳捕集",
        "净零", "碳中和", "碳排放", "减排",
    ],
    # 可再生能源（GKG 目标主题码里没有，但若标题命中也归此类，保持前端 4 主题完整）
    "renewable_energy": [
        "renewable", "solar", "wind power", "wind farm", "clean energy",
        "green energy", "photovoltaic", "geothermal", "hydropower", "hydrogen",
        "biofuel", "可再生", "太阳能", "风能", "清洁能源", "氢能",
    ],
}

# GKG 2.1 列索引（0-based；制表符分隔，27 列）
COL_DATE = 1
COL_SOURCECOMMONNAME = 3
COL_DOCID = 4
COL_V1THEMES = 7
COL_V1LOCATIONS = 9
COL_V15TONE = 15
COL_EXTRAS = 26

_PAGE_TITLE_RE = re.compile(r"<PAGE_TITLE>(.*?)</PAGE_TITLE>", re.S | re.I)


def http_get(url: str, binary: bool = False):
    req = urllib.request.Request(
        url, headers={"User-Agent": "climate-news-viz/1.0 (GKG batch)"}
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        data = resp.read()
    return data if binary else data.decode("utf-8", "replace")


def get_latest_gkg_url(lastupdate_url: str, suffix: str) -> str | None:
    try:
        text = http_get(lastupdate_url)
    except Exception as e:
        print(f"[err] {lastupdate_url} fetch failed: {e}", file=sys.stderr)
        return None
    for line in text.splitlines():
        parts = line.strip().split()
        if not parts:
            continue
        u = parts[-1]
        if u.endswith(suffix):
            return u
    print(f"[err] no '{suffix}' line in {lastupdate_url}", file=sys.stderr)
    return None


def load_processed() -> set:
    if not os.path.exists(PROCESSED_FILE):
        return set()
    try:
        with open(PROCESSED_FILE, encoding="utf-8") as f:
            return {ln.strip() for ln in f if ln.strip()}
    except Exception:
        return set()


def save_processed(done: set):
    os.makedirs(TRACK_DIR, exist_ok=True)
    # 只保留最近 400 个文件名（两套 × ~200），避免无限增长
    items = sorted(done)[-400:]
    with open(PROCESSED_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(items) + "\n")


def parse_gkg_date(s: str) -> str | None:
    s = s.strip()
    if len(s) < 14 or not s.isdigit():
        return None
    try:
        dt = datetime(int(s[0:4]), int(s[4:6]), int(s[6:8]),
                      int(s[8:10]), int(s[10:12]), int(s[12:14]),
                      tzinfo=timezone.utc)
        return dt.isoformat()
    except Exception:
        return None


def extract_country(locations: str) -> str | None:
    if not locations:
        return None
    first = locations.split(";")[0]
    fields = first.split("#")
    if len(fields) >= 3 and fields[2]:
        return fields[2].strip()
    return None


def extract_title(extras: str, fallback: str) -> str:
    if extras:
        m = _PAGE_TITLE_RE.search(extras)
        if m:
            t = m.group(1).strip()
            if t:
                return t
    return fallback or ""


def keyword_hit(text_lc: str, topic: str) -> bool:
    """标题/主题文本是否命中该 topic 的气候关键词。"""
    for kw in CLIMATE_KEYWORDS.get(topic, []):
        if kw in text_lc:
            return True
    return False


def classify_row(row_themes: set, title: str) -> list:
    """
    返回该行最终归属的 topic 列表（空 = 过滤掉）。
    规则：
      - 强主题命中 -> 直接归对应 topic；
      - 噪声主题(NATURAL_DISASTER)命中 -> 仅当 标题 或 主题文本 命中
        extreme_weather 关键词时才归 extreme_weather；
      - 另外：若标题命中其它气候关键词组（如 renewable_energy / carbon_policy /
        climate_change），也补充对应 topic（增强召回，保持前端 4 主题完整）。
    """
    hit = TARGET_THEMES & row_themes
    if not hit:
        return []

    # 关键词只在标题里匹配——主题串/地名常含 storm/flood 等碎片，会误放行噪声。
    title_lc = (title or "").lower()

    topics = set()

    for code in hit:
        topic = THEME_TO_TOPIC[code]
        if code in STRONG_THEMES:
            topics.add(topic)
        elif code in NOISY_THEMES:
            # 噪声主题：须标题命中气候/天气关键词才放行
            if keyword_hit(title_lc, "extreme_weather"):
                topics.add("extreme_weather")

    # 若该行已被强主题接纳，顺带按标题关键词补充其它相关 topic（仅在已相关时）
    if topics:
        for extra_topic in ("renewable_energy", "carbon_policy", "climate_change"):
            if keyword_hit(title_lc, extra_topic):
                topics.add(extra_topic)

    return sorted(topics)


def process_csv(csv_text: str, articles_by_url: dict,
                vol_buckets, tone_sum, tone_cnt) -> int:
    matched = 0
    reader = csv.reader(io.StringIO(csv_text), delimiter="\t")
    for fields in reader:
        if len(fields) < 27:
            continue
        themes_raw = fields[COL_V1THEMES]
        if not themes_raw:
            continue
        row_themes = set(themes_raw.split(";"))
        if not (TARGET_THEMES & row_themes):
            continue

        url = fields[COL_DOCID].strip()
        if not url or not url.startswith("http"):
            continue
        iso = parse_gkg_date(fields[COL_DATE])
        if not iso:
            continue

        domain = fields[COL_SOURCECOMMONNAME].strip()
        title = extract_title(fields[COL_EXTRAS], domain)

        topics = classify_row(row_themes, title)
        if not topics:
            continue  # 双重过滤未通过（噪声行）
        matched += 1

        tone_val = None
        tone_raw = fields[COL_V15TONE]
        if tone_raw:
            try:
                tone_val = float(tone_raw.split(",")[0])
            except Exception:
                tone_val = None
        country = extract_country(fields[COL_V1LOCATIONS])

        if url in articles_by_url:
            for t in topics:
                if t not in articles_by_url[url]["topics"]:
                    articles_by_url[url]["topics"].append(t)
        else:
            articles_by_url[url] = {
                "url": url,
                "title": title,
                "url_mobile": None,
                "socialimage": None,
                "domain": domain or None,
                "language": None,
                "sourcecountry": country,
                "seendate": iso,
                "topics": topics,
            }

        bucket = iso
        for t in set(topics) | {"all"}:
            vol_buckets[t][bucket] += 1
            if tone_val is not None:
                tone_sum[t][bucket] += tone_val
                tone_cnt[t][bucket] += 1
    return matched


def main():
    processed = load_processed()
    articles_by_url = {}
    vol_buckets = defaultdict(lambda: defaultdict(int))
    tone_sum = defaultdict(lambda: defaultdict(float))
    tone_cnt = defaultdict(lambda: defaultdict(int))

    any_new = False
    any_fetch_ok = False
    used_files = []

    for name, lastupdate_url, suffix in SOURCES:
        gkg_url = get_latest_gkg_url(lastupdate_url, suffix)
        if not gkg_url:
            continue
        fname = gkg_url.rsplit("/", 1)[-1]
        if fname in processed:
            print(f"[skip] {name} already processed: {fname}", file=sys.stderr)
            continue
        any_new = True
        try:
            raw = http_get(gkg_url, binary=True)
            zf = zipfile.ZipFile(io.BytesIO(raw))
            csv_bytes = zf.read(zf.namelist()[0])
            csv_text = csv_bytes.decode("utf-8", "replace")
        except Exception as e:
            print(f"[err] {name} download/unzip failed: {e}", file=sys.stderr)
            continue
        any_fetch_ok = True
        m = process_csv(csv_text, articles_by_url, vol_buckets, tone_sum, tone_cnt)
        print(f"[ok] {name} {fname}: matched={m}", file=sys.stderr)
        used_files.append(fname)
        processed.add(fname)

    if not any_new:
        print("[skip] all GKG files already processed", file=sys.stderr)
        sys.exit(2)
    if not any_fetch_ok:
        print("[err] all fetches failed", file=sys.stderr)
        sys.exit(3)

    # 组装 timeline
    timelines = []
    for topic, buckets in vol_buckets.items():
        pts = [{"date": d, "value": float(c)} for d, c in sorted(buckets.items())]
        if pts:
            timelines.append({"topic": topic, "series": "volume", "points": pts})
    for topic, buckets in tone_sum.items():
        pts = []
        for d in sorted(buckets.keys()):
            n = tone_cnt[topic][d]
            if n > 0:
                pts.append({"date": d, "value": round(buckets[d] / n, 4)})
        if pts:
            timelines.append({"topic": topic, "series": "tone", "points": pts})

    payload = {
        "articles": list(articles_by_url.values()),
        "timeline": timelines,
        "gkg_files": used_files,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
    with open(PAYLOAD_OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)

    # 标记已处理（即便 articles=0 也标记，避免重复下载本批）
    save_processed(processed)
    print(f"files={used_files} articles={len(payload['articles'])} "
          f"timelines={len(timelines)} -> {PAYLOAD_OUT}")
    sys.exit(0)


if __name__ == "__main__":
    main()
