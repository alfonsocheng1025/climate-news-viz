# 气候新闻 GKG 抓取 — GitHub Actions 自动化部署说明

把每 15 分钟的 GDELT GKG 抓取 + 全文提取 + 写入 Supabase 的管线，
从 Perplexity 定时任务迁移到 GitHub Actions。免费、独立运行，不依赖 Perplexity。

## 工作原理

`.github/workflows/climate-ingest.yml` 每 15 分钟（UTC `*/15 * * * *`）触发：

1. checkout 仓库 + 装 Python 依赖（`scripts/requirements.txt`）
2. 从 `actions/cache` 恢复幂等追踪文件 `.gkg_track/processed_gkg.txt`
3. 跑 `scripts/run_gkg_pipeline.py`：
   - 读 `lastupdate.txt`（English GKG）+ `lastupdate-translation.txt`（Translingual GKG）
   - 按 4 主题码（ENV_CLIMATECHANGE / NATURAL_DISASTER / ENV_CARBONCAPTURE / WB_567_CLIMATE_CHANGE）
     + 气候关键词过滤
   - 抓取每篇文章全文（媒体 / 记者 / 时间 / 导语 / 正文 / 图片）
   - 生成入库 SQL `/tmp/gdelt_upsert.sql`
   - 已处理过的 GKG 文件自动跳过（幂等）
4. 若有新数据，跑 `scripts/ingest_db.py` 直连 Supabase 写库

退出码：2 = 本轮无新文件（正常跳过）；3 = 抓取失败（本轮跳过）；0 = 有数据已入库。

## 上线步骤（你需要做的）

### 1. 推代码到 GitHub

```bash
git remote add origin <你的仓库地址>   # 如已有 remote 跳过
git add .github scripts/ingest_db.py scripts/requirements.txt scripts/GITHUB_ACTIONS_SETUP.md .gitignore
git commit -m "ci: GitHub Actions every-15-min GKG ingest into Supabase"
git push origin master   # 或 main
```

### 2. 配置 GitHub Secret（仓库 Settings → Secrets and variables → Actions → New repository secret）

只需 **1 个 Secret**：

| 名称 | 值 |
| --- | --- |
| `SUPABASE_DB_URL` | Supabase 连接池字符串（见下） |

**如何获取 `SUPABASE_DB_URL`：**
Supabase Dashboard → 项目 stockpicker → 顶部 **Connect** 按钮 → 选 **Connection string** →
选 **Transaction pooler**（或 Session pooler）的 URI。形如：

```
postgresql://postgres.sgldkmzwzcwurkwpobhn:[你的数据库密码]@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres
```

把 `[你的数据库密码]` 替换成真实密码（首次创建项目时设置的，忘了可在
Settings → Database → Reset database password 重置）。

> 为什么用 Pooler 而不是 `db.<ref>.supabase.co:5432` 直连：
> GitHub Actions 是 IPv4 环境，直连 host 是 IPv6-only 会连不上；
> Pooler（`aws-0-<region>.pooler.supabase.com`）支持 IPv4。

### 3. 启用 + 测试

- push 后，去仓库 **Actions** 标签页，应能看到 "Climate GKG Ingest" workflow。
- 点进去 → **Run workflow**（手动触发一次）验证能跑通 + 写库。
- 之后它会每 15 分钟自动跑。

> 注意：GitHub Actions 的 schedule 在高峰期可能延迟几分钟，且仓库 60 天无 push
> 活动后 schedule 会自动停（GitHub 策略）。本任务幂等，延迟无影响。

## 关闭 Perplexity 端的定时任务

迁移上线、确认 GitHub Actions 跑通后，再去 Perplexity 把那个每 15 分钟的定时任务删除即可。
