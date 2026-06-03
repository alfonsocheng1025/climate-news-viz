-- 0002: 指标取数改造 —— 全量聚合 RPC + 语言派生
-- 1) climate_articles 单次读取上限由 250 提升至 1000（仅供高频实体/词云的客户端统计）
-- 2) 新增 climate_total_count / climate_outlets / climate_languages / climate_search
--    四个服务端聚合/搜索 RPC，使「报道总量 / 媒体来源排行 / 语言分布 / 报道流」走全量。

CREATE OR REPLACE FUNCTION public.climate_articles(p_topic text, p_hours integer, p_max integer DEFAULT 60)
 RETURNS SETOF climate.articles
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'climate','public'
AS $function$
  SELECT * FROM climate.articles
  WHERE seendate >= now() - make_interval(hours => p_hours)
    AND (p_topic = 'all' OR p_topic = ANY(topics))
  ORDER BY seendate DESC
  LIMIT LEAST(p_max, 1000);
$function$;

CREATE OR REPLACE FUNCTION public.climate_total_count(p_topic text, p_hours integer)
 RETURNS bigint
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'climate','public'
AS $function$
  SELECT count(*) FROM climate.articles
  WHERE seendate >= now() - make_interval(hours => p_hours)
    AND (p_topic = 'all' OR p_topic = ANY(topics));
$function$;

CREATE OR REPLACE FUNCTION public.climate_outlets(p_topic text, p_hours integer, p_limit integer DEFAULT 12)
 RETURNS TABLE(outlet text, domain text, cnt bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'climate','public'
AS $function$
  SELECT COALESCE(NULLIF(max(outlet), ''), domain) AS outlet, domain, count(*) AS cnt
  FROM climate.articles
  WHERE seendate >= now() - make_interval(hours => p_hours)
    AND (p_topic = 'all' OR p_topic = ANY(topics))
    AND domain IS NOT NULL AND domain <> ''
  GROUP BY domain
  ORDER BY cnt DESC
  LIMIT LEAST(p_limit, 50);
$function$;

CREATE OR REPLACE FUNCTION public.climate_languages(p_topic text, p_hours integer)
 RETURNS TABLE(language text, cnt bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'climate','public'
AS $function$
  SELECT COALESCE(NULLIF(language, ''), 'unknown') AS language, count(*) AS cnt
  FROM climate.articles
  WHERE seendate >= now() - make_interval(hours => p_hours)
    AND (p_topic = 'all' OR p_topic = ANY(topics))
  GROUP BY 1
  ORDER BY cnt DESC;
$function$;

CREATE OR REPLACE FUNCTION public.climate_search(p_topic text, p_hours integer, p_q text DEFAULT '', p_limit integer DEFAULT 12, p_offset integer DEFAULT 0)
 RETURNS TABLE(rows jsonb, total bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'climate','public'
AS $function$
  WITH filtered AS (
    SELECT * FROM climate.articles
    WHERE seendate >= now() - make_interval(hours => p_hours)
      AND (p_topic = 'all' OR p_topic = ANY(topics))
      AND (
        COALESCE(p_q,'') = '' OR
        title ILIKE '%'||p_q||'%' OR
        COALESCE(lede,'') ILIKE '%'||p_q||'%' OR
        COALESCE(body,'') ILIKE '%'||p_q||'%' OR
        COALESCE(outlet,'') ILIKE '%'||p_q||'%' OR
        COALESCE(domain,'') ILIKE '%'||p_q||'%'
      )
  ), cnt AS (SELECT count(*) AS n FROM filtered)
  SELECT to_jsonb(p.*) AS rows, (SELECT n FROM cnt) AS total
  FROM (
    SELECT * FROM filtered ORDER BY seendate DESC
    LIMIT LEAST(p_limit, 60) OFFSET GREATEST(p_offset, 0)
  ) p;
$function$;

GRANT EXECUTE ON FUNCTION public.climate_total_count(text,integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.climate_outlets(text,integer,integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.climate_languages(text,integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.climate_search(text,integer,text,integer,integer) TO anon, authenticated;
