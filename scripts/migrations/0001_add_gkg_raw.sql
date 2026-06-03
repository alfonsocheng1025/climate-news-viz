-- =====================================================================
-- 迁移 0001：在 climate.articles 增加 gkg_raw (jsonb)，保存每篇新闻命中行的
--             全部 27 个 GDELT GKG 2.1 原始字段（命名字段）。
-- 配套：fetch_gkg.py 现在为每篇命中文章构造 gkg_raw；climate_upsert_articles
--       RPC 已更新以写入该列。
-- 已于 2026-06-03 应用到 Supabase 项目 sgldkmzwzcwurkwpobhn。
-- =====================================================================

-- 1) 新增列
ALTER TABLE climate.articles ADD COLUMN IF NOT EXISTS gkg_raw jsonb;

-- 2) 更新写入 RPC，纳入 gkg_raw（其余字段逻辑不变）
CREATE OR REPLACE FUNCTION public.climate_upsert_articles(p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'climate', 'public'
AS $function$
DECLARE n integer;
BEGIN
  WITH incoming AS (
    SELECT
      (r->>'url')::text AS url,
      (r->>'title')::text AS title,
      (r->>'url_mobile')::text AS url_mobile,
      (r->>'socialimage')::text AS socialimage,
      (r->>'domain')::text AS domain,
      (r->>'language')::text AS language,
      (r->>'sourcecountry')::text AS sourcecountry,
      (r->>'seendate')::timestamptz AS seendate,
      ARRAY(SELECT jsonb_array_elements_text(r->'topics')) AS topics,
      (r->>'outlet')::text AS outlet,
      CASE WHEN r ? 'authors' THEN ARRAY(SELECT jsonb_array_elements_text(r->'authors')) ELSE NULL END AS authors,
      CASE WHEN (r->>'published_at') IS NOT NULL AND (r->>'published_at') <> '' THEN (r->>'published_at')::timestamptz ELSE NULL END AS published_at,
      (r->>'lede')::text AS lede,
      (r->>'body')::text AS body,
      (r->>'top_image')::text AS top_image,
      CASE WHEN r ? 'images' THEN ARRAY(SELECT jsonb_array_elements_text(r->'images')) ELSE NULL END AS images,
      (r->>'content_status')::text AS content_status,
      CASE WHEN (r->>'content_fetched_at') IS NOT NULL AND (r->>'content_fetched_at') <> '' THEN (r->>'content_fetched_at')::timestamptz ELSE NULL END AS content_fetched_at,
      CASE WHEN r ? 'gkg_raw' THEN (r->'gkg_raw') ELSE NULL END AS gkg_raw
    FROM jsonb_array_elements(p_rows) AS r
    WHERE (r->>'url') IS NOT NULL AND (r->>'seendate') IS NOT NULL
  )
  INSERT INTO climate.articles AS a
    (url, title, url_mobile, socialimage, domain, language, sourcecountry, seendate, topics,
     outlet, authors, published_at, lede, body, top_image, images, content_status, content_fetched_at, gkg_raw)
  SELECT url, title, url_mobile, socialimage, domain, language, sourcecountry, seendate, topics,
     outlet, authors, published_at, lede, body, top_image, images, content_status, content_fetched_at, gkg_raw FROM incoming
  ON CONFLICT (url) DO UPDATE SET
    title = COALESCE(EXCLUDED.title, a.title),
    socialimage = COALESCE(EXCLUDED.socialimage, a.socialimage),
    topics = ARRAY(SELECT DISTINCT unnest(a.topics || EXCLUDED.topics)),
    outlet = COALESCE(EXCLUDED.outlet, a.outlet),
    authors = COALESCE(EXCLUDED.authors, a.authors),
    published_at = COALESCE(EXCLUDED.published_at, a.published_at),
    lede = COALESCE(EXCLUDED.lede, a.lede),
    body = COALESCE(EXCLUDED.body, a.body),
    top_image = COALESCE(EXCLUDED.top_image, a.top_image),
    images = COALESCE(EXCLUDED.images, a.images),
    content_status = COALESCE(EXCLUDED.content_status, a.content_status),
    content_fetched_at = COALESCE(EXCLUDED.content_fetched_at, a.content_fetched_at),
    gkg_raw = COALESCE(EXCLUDED.gkg_raw, a.gkg_raw);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $function$;
