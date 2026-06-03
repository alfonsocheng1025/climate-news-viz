# 气候新闻 GKG 抓取 — GitHub Actions 自动化部署说明

把每 15 分钟的 GDELT GKG 抓取 + 全文提取 + 写入 Supabase 的管线，
从 Perplexity 定时任务迁移到 GitHub Actions。免费、独立运行，不依赖 Perplexity。

## 工作原理

`.github/workflows/climate-ingest.yml` 每 15 分钟（UTC `*/15 * * * *`）触发：

1. checkout 仓库 + 装 Python 依赖（`scripts/requirements.txt`，仅 trafilatura）
2. 从 `actions/cache` 恢复幂等追踪文件 `.gkg_track/processed_gkg.txt`
3. 跑 `scripts/run_gkg_pipeline.py`：
   - 读 `lastupdate.txt`（English GKG）+ `lastupdate-translation.txt`（Translingual GKG）
   - 按 4 主题码（ENV_CLIMATECHANGE / NATURAL_DISASTER / ENV_CARBONCAPTURE / WB_567_CLIMATE_CHANGE）
     + 气候关键词过滤
   - 抓取每篇文章全文（媒体 / 记者 / 时间 / 导语 / 正文 / 图片）
   - 富化结果写回 `/tmp/gdelt_payload.json`
   - 已处理过的 GKG 文件自动跳过（幂等）
4. 若有新数据，跑 `scripts/ingest_db.py`：用 anon key 通过 Supabase REST
   调用 `climate_upsert_articles` / `climate_upsert_timeline` 写入 climate schema

退出码：2 = 本轮无新文件（正常跳过）；3 = 抓取失败（本轮跳过）；0 = 有数据已入库。

## 入库凭证说明（为什么用 anon key）

该 Supabase 项目（stockpicker）被另一个项目共用，数据库密码不能改；
service_role key 也取不到。解决办法：写函数（`climate_upsert_*`，均为
`SECURITY DEFINER`）已 `GRANT EXECUTE ... TO anon`，因此公开的 anon key
即可安全调用——只能写气候表，动不了其他对象。

> 安全权衡：anon key 公开，理论上他人也能往气候表 upsert 数据，但只限气候表、
> 无法读写其他对象。对这个公开新闻聚合 demo 可接受。如需收紧，可改回 service_role。

## 已配置的 GitHub Secrets（仓库 Settings → Secrets and variables → Actions）

| 名称 | 值 |
| --- | --- |
| `SUPABASE_URL` | `https://sgldkmzwzcwurkwpobhn.supabase.co` |
| `SUPABASE_ANON_KEY` | 项目 anon 公钥（JWT） |

（已通过 gh CLI 设好，无需再手动配置。）

## 启用 + 测试

- 仓库 **Actions** 标签页 → "Climate GKG Ingest" → **Run workflow** 手动触发一次验证。
- 之后每 15 分钟自动跑。

> 注意：GitHub Actions 的 schedule 在高峰期可能延迟几分钟；公开仓库 Actions
> 免费、额度无限。仓库 60 天无 push 活动后 schedule 会自动停（GitHub 策略）。

## 关闭 Perplexity 端的定时任务

确认 GitHub Actions 跑通后，再去 Perplexity 把那个每 15 分钟的定时任务删除即可。
