#!/usr/bin/env python3
"""
把 /tmp/gdelt_payload.json 转成可执行的 SQL（调用 climate_upsert_* RPC）。
输出到 /tmp/gdelt_upsert.sql，由 MCP execute_sql 执行（service_role 权限）。

为什么走 SQL 而不是直接 REST：写函数仅授权 service_role，沙盒里没有该密钥，
而 MCP execute_sql 以特权角色运行，最安全、无需在沙盒存放密钥。
"""
import json

with open("/tmp/gdelt_payload.json", encoding="utf-8") as f:
    payload = json.load(f)


def jlit(obj) -> str:
    """把 Python 对象转成 PostgreSQL 字符串字面量里的 jsonb（转义单引号）。"""
    s = json.dumps(obj, ensure_ascii=False)
    return "'" + s.replace("'", "''") + "'"


stmts = []

articles = payload.get("articles", [])
if articles:
    # 分批，避免单条 SQL 过大（全文 body 字段较大，按小批切分）
    BATCH = 10
    for i in range(0, len(articles), BATCH):
        chunk = articles[i:i + BATCH]
        stmts.append(
            f"SELECT public.climate_upsert_articles({jlit(chunk)}::jsonb);"
        )

for tl in payload.get("timeline", []):
    topic = tl["topic"].replace("'", "''")
    series = tl["series"].replace("'", "''")
    pts = tl.get("points", [])
    if pts:
        stmts.append(
            f"SELECT public.climate_upsert_timeline('{topic}','{series}',{jlit(pts)}::jsonb);"
        )

sql = "\n".join(stmts) if stmts else "SELECT 1;"
with open("/tmp/gdelt_upsert.sql", "w", encoding="utf-8") as f:
    f.write(sql)

print(f"statements={len(stmts)} articles={len(articles)} "
      f"timelines={len(payload.get('timeline', []))} -> /tmp/gdelt_upsert.sql "
      f"(bytes={len(sql)})")
