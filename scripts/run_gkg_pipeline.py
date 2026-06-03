#!/usr/bin/env python3
"""
GKG 每日管线编排器（cron 用）
============================================================
一条命令跑完：抓取 GKG -> 全文富化 -> 生成入库 SQL -> 切成小分片。
随后 cron 读取每个分片调用 Supabase execute_sql 入库。

为什么切分片：文章含全文 body，单条 SQL 较大；按小批/单语句切到
/tmp/sqlparts/NNN.sql，每片可单独安全地交给 execute_sql。

退出码：
  0 = 有数据，分片已生成（cron 继续执行 SQL）
  2 = 本轮无新 GKG 文件 或 无气候文章（cron 静默结束，不入库）
  3 = 抓取失败（cron 静默结束）
打印（stdout 最后一行）：PARTS=/tmp/sqlparts COUNT=<n> ARTICLES=<n>
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable
PAYLOAD = "/tmp/gdelt_payload.json"
SQL = "/tmp/gdelt_upsert.sql"
PARTS_DIR = "/tmp/sqlparts"


def run(script, env=None):
    e = dict(os.environ)
    if env:
        e.update(env)
    p = subprocess.run([PY, os.path.join(HERE, script)], env=e,
                       capture_output=True, text=True)
    sys.stderr.write(p.stderr)
    sys.stdout.write(p.stdout)
    return p.returncode


def main():
    # 1) 抓取 GKG（双源 + 关键词过滤 + 幂等）
    rc = run("fetch_gkg.py")
    if rc == 2:
        print("PIPELINE skip: no new GKG files")
        sys.exit(2)
    if rc == 3:
        print("PIPELINE fail: fetch failed")
        sys.exit(3)

    with open(PAYLOAD, encoding="utf-8") as f:
        payload = json.load(f)
    if not payload.get("articles"):
        print("PIPELINE skip: no climate articles this batch")
        sys.exit(2)

    # 2) 全文富化（抓原文：媒体/作者/时间/导语/正文/图片）
    run("fetch_fulltext.py")

    # 3) 生成入库 SQL
    rc = run("build_upsert_sql.py")
    if rc != 0:
        print("PIPELINE fail: build_upsert_sql failed")
        sys.exit(3)

    # 4) 切分片（build_upsert_sql 以换行连接，每行一条语句）
    os.makedirs(PARTS_DIR, exist_ok=True)
    for fn in os.listdir(PARTS_DIR):
        try:
            os.remove(os.path.join(PARTS_DIR, fn))
        except OSError:
            pass
    with open(SQL, encoding="utf-8") as f:
        lines = [ln for ln in f.read().split("\n") if ln.strip()]
    for i, ln in enumerate(lines):
        with open(os.path.join(PARTS_DIR, f"{i:03d}.sql"), "w", encoding="utf-8") as f:
            f.write(ln)

    with open(PAYLOAD, encoding="utf-8") as f:
        payload = json.load(f)
    print(f"PARTS={PARTS_DIR} COUNT={len(lines)} ARTICLES={len(payload['articles'])} "
          f"FILES={payload.get('gkg_files')}")
    sys.exit(0)


if __name__ == "__main__":
    main()
