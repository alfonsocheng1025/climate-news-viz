#!/usr/bin/env python3
"""
新闻原文全文抓取脚本（方案 A 富文本入库）
============================================================
读 /tmp/gdelt_payload.json（fetch_gkg.py 产出的命中文章列表），
按每篇文章 URL 抓取原文页面，用 trafilatura 解析出：
  - outlet（媒体名 / sitename）
  - authors（记者/作者，list）
  - published_at（发布时间 ISO8601）
  - lede（导语：正文首段，截断）
  - body（正文全文）
  - top_image（主图链接）
  - images（正文内图片链接 list）
解析结果回填到 payload['articles'] 各条目，并标记 content_status，
覆盖写回 /tmp/gdelt_payload.json，供 build_upsert_sql.py 一并入库。

设计要点：
  - 并发抓取（线程池），但限制并发数 + 单页超时，避免拖垮整轮；
  - 容错：单页失败不影响其它，标 content_status=error/timeout/empty；
  - 限制每轮抓取上限 MAX_FETCH，控制时长与资源（cron 6am 跑一次，够用）；
  - body 截断到 BODY_MAX 字符，避免单行 SQL 过大。
"""
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import trafilatura
from trafilatura.settings import use_config

PAYLOAD = "/tmp/gdelt_payload.json"

MAX_FETCH = int(os.environ.get("FULLTEXT_MAX", "250"))   # 每轮最多抓多少篇
MAX_WORKERS = int(os.environ.get("FULLTEXT_WORKERS", "8"))
FETCH_TIMEOUT = 20            # 单页下载超时（trafilatura 内部）
BODY_MAX = int(os.environ.get("FULLTEXT_BODY_MAX", "8000"))   # 正文最多保留字符
LEDE_MAX = 400               # 导语最多保留字符

# trafilatura 配置：缩短超时
_cfg = use_config()
_cfg.set("DEFAULT", "DOWNLOAD_TIMEOUT", str(FETCH_TIMEOUT))


def to_iso(date_str: str | None) -> str | None:
    """trafilatura 的 date 形如 '2026-06-03' 或 '2026-06-03T11:00:00'。"""
    if not date_str:
        return None
    s = date_str.strip()
    try:
        # 仅日期 -> 补到当天 00:00 UTC
        if len(s) == 10:
            dt = datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        else:
            s2 = s.replace("Z", "+00:00")
            dt = datetime.fromisoformat(s2)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    except Exception:
        return None


def split_authors(author) -> list:
    if not author:
        return []
    if isinstance(author, list):
        items = author
    else:
        # trafilatura 用 ';' 连接多个作者
        items = str(author).replace(",", ";").split(";")
    out = []
    for a in items:
        a = a.strip()
        if a and a.lower() not in ("none", "null") and len(a) < 120:
            out.append(a)
    # 去重保序
    seen = set()
    uniq = []
    for a in out:
        if a not in seen:
            seen.add(a)
            uniq.append(a)
    return uniq[:8]


def extract_one(art: dict) -> dict:
    """抓取并解析单篇，回填字段；返回更新后的 art。"""
    url = art["url"]
    art["content_fetched_at"] = datetime.now(timezone.utc).isoformat()
    try:
        downloaded = trafilatura.fetch_url(url, config=_cfg)
        if not downloaded:
            art["content_status"] = "fetch_failed"
            return art
        # 结构化元数据 + 正文
        data = trafilatura.extract(
            downloaded, config=_cfg, output_format="json",
            with_metadata=True, include_images=True, include_links=False,
            favor_precision=True,
        )
        if not data:
            art["content_status"] = "empty"
            return art
        meta = json.loads(data)
    except Exception as e:
        art["content_status"] = "error"
        art["_err"] = str(e)[:120]
        return art

    body = (meta.get("text") or "").strip()
    if not body:
        art["content_status"] = "empty"
        return art

    art["body"] = body[:BODY_MAX]
    # 导语：首个「文本」段落（跳过纯 markdown 图片行如 ![](...)）
    _img_line = re.compile(r"^!\[.*?\]\(.*?\)\s*$")
    first_para = ""
    for p in body.split("\n"):
        p = p.strip()
        if not p or _img_line.match(p):
            continue
        first_para = p
        break
    art["lede"] = (first_para or body)[:LEDE_MAX]

    outlet = meta.get("sitename") or meta.get("hostname")
    if outlet:
        art["outlet"] = str(outlet)[:200]

    authors = split_authors(meta.get("author"))
    if authors:
        art["authors"] = authors

    pub = to_iso(meta.get("date"))
    if pub:
        art["published_at"] = pub

    # 主图
    top_img = meta.get("image")
    if top_img:
        art["top_image"] = str(top_img)
        if not art.get("socialimage"):
            art["socialimage"] = str(top_img)

    # 正文内图片：优先用元数据 images；否则从 body 的 markdown 图片采集
    clean = []
    imgs = meta.get("images")
    if imgs and isinstance(imgs, list):
        clean = [str(i) for i in imgs if i and str(i).startswith("http")]
    if not clean:
        clean = re.findall(r"!\[[^\]]*\]\((https?://[^)\s]+)\)", body)
    if top_img and str(top_img).startswith("http"):
        clean = [str(top_img)] + [c for c in clean if c != str(top_img)]
    # 去重保序
    seen, uniq = set(), []
    for c in clean:
        if c not in seen:
            seen.add(c); uniq.append(c)
    if uniq:
        art["images"] = uniq[:20]
    # 标题补全（若 GKG 没拿到）
    if not art.get("title") and meta.get("title"):
        art["title"] = str(meta["title"])

    art["content_status"] = "ok"
    return art


def main():
    if not os.path.exists(PAYLOAD):
        print("[err] no payload", file=sys.stderr)
        sys.exit(3)
    with open(PAYLOAD, encoding="utf-8") as f:
        payload = json.load(f)

    articles = payload.get("articles", [])
    if not articles:
        print("[info] no articles to enrich", file=sys.stderr)
        sys.exit(0)

    targets = articles[:MAX_FETCH]
    print(f"[info] enriching {len(targets)}/{len(articles)} articles "
          f"workers={MAX_WORKERS}", file=sys.stderr)

    results = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futs = {ex.submit(extract_one, dict(a)): i for i, a in enumerate(targets)}
        for fut in as_completed(futs):
            i = futs[fut]
            try:
                results[i] = fut.result()
            except Exception as e:
                a = dict(targets[i])
                a["content_status"] = "error"
                a["_err"] = str(e)[:120]
                results[i] = a

    # 回填（保留未抓取的尾部文章原样）
    for i in range(len(targets)):
        if i in results:
            articles[i] = results[i]

    payload["articles"] = articles
    payload["fulltext_enriched_at"] = datetime.now(timezone.utc).isoformat()
    with open(PAYLOAD, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)

    ok = sum(1 for a in articles if a.get("content_status") == "ok")
    statuses = {}
    for a in articles:
        s = a.get("content_status", "(none)")
        statuses[s] = statuses.get(s, 0) + 1
    print(f"enriched ok={ok}/{len(targets)} statuses={statuses} -> {PAYLOAD}")


if __name__ == "__main__":
    main()
