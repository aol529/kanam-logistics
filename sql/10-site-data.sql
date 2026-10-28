-- ============================================================
-- KANAM LOGISTICS — all the website's content in one request.
-- Run after 09-access-requests.sql, in the Supabase SQL editor. Safe to re-run.
--
-- site_data(posts) returns settings, page text, products, projects, FAQs,
-- testimonials, team, machinery and companies (and the published news
-- when posts is true) as one JSON object, so a page makes one request
-- instead of ten. It runs as the caller, so row level security still
-- decides what visitors see; the filters match what the site asked for before.
-- ============================================================

create or replace function public.site_data(p_posts boolean default false) returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'settings',     (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'value', value)), '[]') from settings),
    'content',      (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'value', value)), '[]') from content),
    'products',     (select coalesce(jsonb_agg(t order by t.sort, t.size_kg), '[]') from products t where t.published),
    'projects',     (select coalesce(jsonb_agg(t order by t.sort, t.created_at desc), '[]') from projects t where t.published),
    'faqs',         (select coalesce(jsonb_agg(t order by t.sort), '[]') from faqs t where t.published),
    'testimonials', (select coalesce(jsonb_agg(t order by t.sort), '[]') from testimonials t where t.published),
    'team',         (select coalesce(jsonb_agg(t order by t.sort), '[]') from team t where t.published),
    'equipment',    (select coalesce(jsonb_agg(t order by t.sort, t.name), '[]') from equipment t where t.published),
    'companies',    (select coalesce(jsonb_agg(t order by t.sort, t.name), '[]') from companies t where t.published),
    'posts', case when p_posts then (
      select coalesce(jsonb_agg(t order by t.published_at desc), '[]') from (
        select id, slug, title, excerpt, body, cover_path, published_at, author_name from posts
        where status = 'published' and published_at <= now()
        order by published_at desc limit 100) t)
      else '[]' end
  );
$$;
revoke all on function public.site_data(boolean) from public;
grant execute on function public.site_data(boolean) to anon, authenticated;
