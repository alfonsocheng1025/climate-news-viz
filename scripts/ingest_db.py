#!/usr/bin/env python3
"""
通过 Supabase REST 调用写 RPC 入库（GitHub Actions 用）
============================================================
读取 run_gkg_pipeline.py 富化后的 /tmp/gdelt_payload.json，用 anon key 通过
PostgREST 调用 climate_upsert_articles / climate_upsert_timeline 写入 climate schema。

为什么走 anon REST 而不是 psycopg2 直连：
  该 Supabase 项目（stockpicker）被另一个项目共用，数据库密码不能改；
  service_role key 取不到。写函数（SECURITY DEFINER）已 GRANT EXECUTE 给 anon，
  因此用公开 anon key 即可安全调用——只能写气候表，动不了其他对象。

环境变量：
  SUPABASE_URL       项目 API 地址，如 https://sgldkmzwzcwurkwpobhn.supabase.co
  SUPABASE_ANON_KEY  anon 公钥（JWT）
  UPSERT_PAYLOAD     可选，payload 路径（默认 /tmp/gdelt_payload.json）
  ARTICLE_BATCH      可选，每批文章数（默认 10，控制单次请求体大小）

退出码：0=全部成功；1=有批次失败。
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

PAYLOAD = os.environ.get("UPSERT_PAYLOAD", "/tmp/gdelt_payload.json")
BATCH = int(os.environ.get("ARTICLE_BATCH", "10"))
TIMEOUT = 60
RETRIES = 3


def rpc(base_url: str, anon: str, func: str, body: dict) -> tuple[int, str]:
    url = f"{base_url}/rest/v1/rpc/{func}"
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    headers = {
        "apikey": anon,
        "Authorization": f"Bearer {anon}",
        "Content-Type": "application/json",
        # 写 RPC 不需要返回体；最小化响应
        "Prefer": "return=minimal",
    }
    last = (0, "")
    for attempt in range(RETRIES):
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return resp.status, ""
        except urllib.error.HTTPError as e:
            msg = e.read().decode("utf-8", "replace")[:300]
            last = (e.code, msg)
            # 5xx / 429 重试；4xx（除 429）直接失败
            if e.code in (429, 500, 502, 503, 504) and attempt < RETRIES - 1:
                time.sleep(2 * (attempt + 1))
                continue
            return last
        except Exception as e:  # noqa: BLE001
            last = (0, str(e)[:300])
            if attempt < RETRIES - 1:
                time.sleep(2 * (attempt + 1))
                continue
            return last
    return last


def main():
    base_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    anon = os.environ.get("SUPABASE_ANON_KEY", "")
    if not base_url or not anon:
        sys.stderr.write("[ingest] ERROR: SUPABASE_URL / SUPABASE_ANON_KEY not set\n")
        sys.exit(2)

    if not os.path.exists(PAYLOAD):
        sys.stderr.write(f"[ingest] no payload at {PAYLOAD}; nothing to ingest\n")
        sys.exit(0)

    with open(PAYLOAD, encoding="utf-8") as f:
        payload = json.load(f)

    articles = payload.get("articles", []) or []
    timeline = payload.get("timeline", []) or []

    ok, fail = 0, 0

    # 1) 文章分批写入
    for i in range(0, len(articles), BATCH):
        chunk = articles[i:i + BATCH]
        code, msg = rpc(base_url, anon, "climate_upsert_articles", {"p_rows": chunk})
        if 200 <= code < 300:
            ok += 1
        else:
            fail += 1
            sys.stderr.write(f"[ingest] articles batch {i//BATCH} FAILED http={code} {msg}\n")

    # 2) 时间序列逐条写入
    for t in timeline:
        code, msg = rpc(base_url, anon, "climate_upsert_timeline", {
            "p_topic": t.get("topic"),
            "p_series": t.get("series"),
            "p_points": t.get("points", []),
        })
        if 200 <= code < 300:
            ok += 1
        else:
            fail += 1
            sys.stderr.write(
                f"[ingest] timeline {t.get('topic')}/{t.get('series')} FAILED http={code} {msg}\n")

    print(f"[ingest] done ok={ok} fail={fail} "
          f"(articles={len(articles)} in {(len(articles)+BATCH-1)//BATCH} batches, "
          f"timeline={len(timeline)})")
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
