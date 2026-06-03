#!/usr/bin/env python3
"""
直连 Supabase Postgres 入库（GitHub Actions 用，替代 Perplexity execute_sql 连接器）
============================================================
读取 run_gkg_pipeline.py 生成的 /tmp/gdelt_upsert.sql（按换行分隔的多条
SELECT public.climate_upsert_*(...) 语句），用 psycopg2 直连数据库逐条执行。

为什么直连而不用 REST：写函数（climate_upsert_*）仅授权 service_role；
直连数据库以特权角色执行 SQL 最简单可靠，无需暴露写 RPC 给 REST。

连接方式：用 SUPABASE_DB_URL 环境变量（Supabase 连接池字符串）。
GitHub Actions 是 IPv4 环境，必须走 Pooler（aws-0-<region>.pooler.supabase.com:5432
或 :6543），不能用 IPv6-only 的 db.<ref>.supabase.co 直连 host。

退出码：0=全部成功；1=有语句失败（已回滚失败语句，其余已提交）。
"""
import os
import sys

import psycopg2

SQL_FILE = os.environ.get("UPSERT_SQL", "/tmp/gdelt_upsert.sql")


def main():
    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        sys.stderr.write("[ingest_db] ERROR: SUPABASE_DB_URL not set\n")
        sys.exit(2)

    if not os.path.exists(SQL_FILE):
        sys.stderr.write(f"[ingest_db] no SQL file at {SQL_FILE}; nothing to ingest\n")
        sys.exit(0)

    with open(SQL_FILE, encoding="utf-8") as f:
        stmts = [ln for ln in f.read().split("\n") if ln.strip()]

    if not stmts:
        print("[ingest_db] no statements; nothing to ingest")
        sys.exit(0)

    ok, fail = 0, 0
    # sslmode=require 是 Supabase 强制要求
    conn = psycopg2.connect(db_url, sslmode="require", connect_timeout=30)
    try:
        for i, stmt in enumerate(stmts):
            try:
                with conn.cursor() as cur:
                    cur.execute(stmt)
                conn.commit()
                ok += 1
            except Exception as e:  # noqa: BLE001
                conn.rollback()
                fail += 1
                sys.stderr.write(f"[ingest_db] stmt#{i} FAILED: {str(e)[:300]}\n")
    finally:
        conn.close()

    print(f"[ingest_db] done ok={ok} fail={fail} total={len(stmts)}")
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
