#!/usr/bin/env python3
"""导出 climate.articles 全部数据（含全文 body）到 CSV / JSONL / XLSX。
通过 Supabase 连接器的 execute_sql 分批拉取，base64 包裹避免转义问题。"""
import asyncio, json, base64, csv, os, sys

PROJECT = "sgldkmzwzcwurkwpobhn"
OUTDIR = "/home/user/workspace/export"
os.makedirs(OUTDIR, exist_ok=True)

async def call_tool(source_id, tool_name, arguments):
    proc = await asyncio.create_subprocess_exec(
        "external-tool", "call", json.dumps({
            "source_id": source_id, "tool_name": tool_name, "arguments": arguments,
        }),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(err.decode())
    return json.loads(out.decode())

def extract_rows(resp):
    """connector 把结果包在 result 字符串里，且夹在 untrusted-data 边界中。
    我们让 SQL 直接返回 base64(json)，从文本里抠出来解码。"""
    txt = resp.get("result", "") if isinstance(resp, dict) else str(resp)
    # base64 payload 在我们自定义标记 between <<B64>> ... <<END>>
    start = txt.find("<<B64>>")
    end = txt.find("<<END>>")
    if start == -1 or end == -1:
        raise RuntimeError("no b64 marker in: " + txt[:300])
    b64 = txt[start+7:end]
    # connector 把真实换行转义成了字面 \n / \r，并可能有真实空白。
    # postgres base64 输出每 76 字符一个换行，全部去掉。
    b64 = b64.replace("\\n", "").replace("\\r", "")
    b64 = "".join(b64.split())
    raw = base64.b64decode(b64).decode("utf-8")
    return json.loads(raw)

async def fetch_batch(offset, limit):
    # 用 encode 把整批行打成一个 base64 字符串，规避 JSON 转义/截断
    q = f"""
    SELECT '<<B64>>' || replace(replace(encode(convert_to(
      coalesce(json_agg(t ORDER BY t.seendate DESC)::text, '[]'), 'UTF8'), 'base64'),
      chr(10), ''), chr(13), '')
      || '<<END>>' AS payload
    FROM (
      SELECT url, title, lede, body, outlet, domain, sourcecountry, language,
             authors, topics, seendate, published_at, ingested_at,
             content_status, content_fetched_at, top_image, socialimage, url_mobile, images,
             gkg_raw
      FROM climate.articles
      ORDER BY seendate DESC
      OFFSET {offset} LIMIT {limit}
    ) t;
    """
    resp = await call_tool("supabase", "execute_sql", {"project_id": PROJECT, "query": q})
    return extract_rows(resp)

async def main():
    # 先查总数，避免硬编码
    cnt_resp = await call_tool("supabase", "execute_sql", {
        "project_id": PROJECT,
        "query": "SELECT '<<B64>>' || encode(convert_to(count(*)::text,'UTF8'),'base64') || '<<END>>' AS payload FROM climate.articles;",
    })
    total = int(extract_rows(cnt_resp))
    print(f"total rows in DB: {total}", file=sys.stderr)
    batch = 10
    rows = []
    off = 0
    while off < total:
        part = await fetch_batch(off, batch)
        rows.extend(part)
        print(f"fetched {len(rows)}/{total}", file=sys.stderr)
        off += batch
    # 去重（按 url）并按时间排序
    seen = {}
    for r in rows:
        seen[r["url"]] = r
    rows = list(seen.values())
    rows.sort(key=lambda r: (r.get("seendate") or ""), reverse=True)
    print(f"total unique rows: {len(rows)}", file=sys.stderr)

    # 写 JSONL（完整字段，最适合做后续分析/NLP）
    with open(f"{OUTDIR}/climate_articles_full.jsonl", "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    # GKG 2.1 全部 27 列官方字段名（与 fetch_gkg.py 一致），逐列展开进 CSV
    GKG_COLS = [
        "GKGRECORDID","V2_1DATE","V2SOURCECOLLECTIONIDENTIFIER","V2SOURCECOMMONNAME",
        "V2DOCUMENTIDENTIFIER","V1COUNTS","V2_1COUNTS","V1THEMES","V2ENHANCEDTHEMES",
        "V1LOCATIONS","V2ENHANCEDLOCATIONS","V1PERSONS","V2ENHANCEDPERSONS",
        "V1ORGANIZATIONS","V2ENHANCEDORGANIZATIONS","V1_5TONE","V2_1ENHANCEDDATES",
        "V2GCAM","V2_1SHARINGIMAGE","V2_1RELATEDIMAGES","V2_1SOCIALIMAGEEMBEDS",
        "V2_1SOCIALVIDEOEMBEDS","V2_1QUOTATIONS","V2_1ALLNAMES","V2_1AMOUNTS",
        "V2_1TRANSLATIONINFO","V2EXTRAS","_gkg_source","_gkg_file",
    ]

    # 写 CSV（数组字段转成分号连接的字符串；gkg_raw 的命名字段逐列展开，列名前缀 gkg_）
    base_cols = ["url","title","lede","body","outlet","domain","sourcecountry","language",
            "authors","topics","seendate","published_at","ingested_at",
            "content_status","content_fetched_at","top_image","socialimage","url_mobile","images"]
    gkg_col_headers = ["gkg_" + c for c in GKG_COLS]
    cols = base_cols + gkg_col_headers
    def norm(v):
        if v is None: return ""
        if isinstance(v, list): return "; ".join(str(x) for x in v)
        return str(v)
    def gkg_val(raw, key):
        if not isinstance(raw, dict):
            return ""
        v = raw.get(key)
        if v is None:
            return ""
        if isinstance(v, list):
            return "; ".join(str(x) for x in v)
        return str(v)
    with open(f"{OUTDIR}/climate_articles_full.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, quoting=csv.QUOTE_ALL)
        w.writerow(cols)
        for r in rows:
            raw = r.get("gkg_raw")
            base_vals = [norm(r.get(c)) for c in base_cols]
            gkg_vals = [gkg_val(raw, c) for c in GKG_COLS]
            w.writerow(base_vals + gkg_vals)

    # 保存一份原始 JSON 数组
    with open(f"{OUTDIR}/climate_articles_full.json", "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)

    print("DONE", len(rows))

asyncio.run(main())
