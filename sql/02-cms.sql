-- ============================================================
-- KANAM LOGISTICS — CMS: staff roles, page text, media library, news,
-- testimonials, FAQs, team, and an activity log of every change.
-- Run after 01-schema.sql, in the Supabase SQL editor. Safe to re-run.
--
-- Roles (public.staff):
--   admin  : everything, including staff and the activity log
--   editor : website content — pages, news, media, products, projects,
--            testimonials, FAQs, team, settings
--   sales  : inquiries, products (prices, stock) and media
-- Everyone in public.admins from 01-schema.sql becomes an admin here.
-- ============================================================

-- ---------------------------- Staff & roles ----------------------------
create table if not exists public.staff (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  name       text not null default '',
  role       text not null default 'editor' check (role in ('admin', 'editor', 'sales')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.staff enable row level security;

insert into public.staff (user_id, email, role)
  select a.user_id, u.email, 'admin' from public.admins a join auth.users u on u.id = a.user_id
  on conflict (user_id) do nothing;

create or replace function public.staff_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.staff where user_id = auth.uid() and active;
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.staff_role() = 'admin', false);
$$;
create or replace function public.can_edit() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.staff_role() in ('admin', 'editor'), false);
$$;
create or replace function public.can_sell() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.staff_role() in ('admin', 'sales'), false);
$$;
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select public.staff_role() is not null;
$$;
revoke all on function public.staff_role(), public.is_admin(), public.can_edit(), public.can_sell(), public.is_staff() from public;
grant execute on function public.staff_role(), public.is_admin(), public.can_edit(), public.can_sell(), public.is_staff() to anon, authenticated;

drop policy if exists "staff read own row or admin" on public.staff;
create policy "staff read own row or admin" on public.staff for select
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists "admins manage staff" on public.staff;
create policy "admins manage staff" on public.staff for all
  using (public.is_admin()) with check (public.is_admin());

-- Never leave the company without an active admin.
create or replace function public.keep_an_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.staff where role = 'admin' and active) then
    raise exception 'There must always be at least one active admin.';
  end if;
  return null;
end $$;
drop trigger if exists staff_keep_an_admin on public.staff;
create constraint trigger staff_keep_an_admin after update or delete on public.staff
  deferrable initially immediate for each row execute function public.keep_an_admin();

-- Add (or update) a staff member by the email of their Supabase login.
create or replace function public.add_staff(p_email text, p_name text, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not public.is_admin() then raise exception 'Only admins can add staff.'; end if;
  if p_role not in ('admin', 'editor', 'sales') then raise exception 'Unknown role %', p_role; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then
    raise exception 'No login with that email yet. Create it first in Supabase: Authentication → Users → Add user.';
  end if;
  insert into public.staff (user_id, email, name, role, active)
    values (uid, lower(trim(p_email)), coalesce(p_name, ''), p_role, true)
    on conflict (user_id) do update set name = excluded.name, role = excluded.role, active = true;
end $$;
revoke all on function public.add_staff(text, text, text) from public;
grant execute on function public.add_staff(text, text, text) to authenticated;

-- ---------------------------- Activity log ----------------------------
create table if not exists public.activity (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  user_id    uuid,
  email      text not null default '',
  action     text not null,               -- insert / update / delete
  table_name text not null,
  row_id     text not null default '',
  before     jsonb,
  after      jsonb
);
create index if not exists activity_at_idx on public.activity (at desc);
alter table public.activity enable row level security;
drop policy if exists "admins read activity" on public.activity;
create policy "admins read activity" on public.activity for select using (public.is_admin());

create or replace function public.log_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.activity (user_id, email, action, table_name, row_id, before, after)
  values (auth.uid(), coalesce(auth.jwt() ->> 'email', ''), lower(tg_op), tg_table_name,
          coalesce(r ->> 'id', r ->> 'key', r ->> 'user_id', ''),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;

-- ---------------------------- Page text ----------------------------
-- One row per edited piece of text (key = page.section.element, see the
-- data-c attributes in the HTML). No row means the page shows its own text.
create table if not exists public.content (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.content enable row level security;

-- ---------------------------- Media library ----------------------------
create table if not exists public.media (
  id          uuid primary key default gen_random_uuid(),
  path        text not null unique,        -- in the "site" storage bucket
  name        text not null default '',
  alt         text not null default '',
  caption     text not null default '',
  mime        text not null default '',
  size        integer,
  uploaded_by uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
alter table public.media enable row level security;

-- ---------------------------- News ----------------------------
create table if not exists public.posts (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title        text not null,
  excerpt      text not null default '',
  body         text not null default '',   -- simple Markdown
  cover_path   text,
  status       text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  author_name  text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists posts_published_idx on public.posts (published_at desc);
alter table public.posts enable row level security;

-- ---------------------------- Testimonials, FAQs, team ----------------------------
create table if not exists public.testimonials (
  id         uuid primary key default gen_random_uuid(),
  quote      text not null,
  name       text not null,
  org        text not null default '',
  rating     integer check (rating between 1 and 5),
  photo_path text,
  published  boolean not null default true,
  sort       integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.testimonials enable row level security;

create table if not exists public.faqs (
  id         uuid primary key default gen_random_uuid(),
  question   text not null,
  answer     text not null default '',
  topic      text not null default 'General',
  published  boolean not null default true,
  sort       integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.faqs enable row level security;

create table if not exists public.team (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  role       text not null default '',
  bio        text not null default '',
  photo_path text,
  published  boolean not null default true,
  sort       integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.team enable row level security;

-- ---------------------------- Who may do what ----------------------------
-- Visitors read what's published; staff write according to role.
do $$
declare t text;
begin
  -- content, media: everyone reads
  foreach t in array array['content', 'media'] loop
    execute format('drop policy if exists "anyone reads %1$s" on public.%1$I', t);
    execute format('create policy "anyone reads %1$s" on public.%1$I for select using (true)', t);
  end loop;
  -- published rows for visitors, everything for staff
  foreach t in array array['testimonials', 'faqs', 'team'] loop
    execute format('drop policy if exists "anyone reads published %1$s" on public.%1$I', t);
    execute format('create policy "anyone reads published %1$s" on public.%1$I for select using (published or public.is_staff())', t);
  end loop;
  -- editors write
  foreach t in array array['content', 'posts', 'testimonials', 'faqs', 'team', 'projects', 'settings'] loop
    execute format('drop policy if exists "editors write %1$s" on public.%1$I', t);
    execute format('create policy "editors write %1$s" on public.%1$I for all using (public.can_edit()) with check (public.can_edit())', t);
  end loop;
  -- editors and sales write
  foreach t in array array['products', 'media'] loop
    execute format('drop policy if exists "staff write %1$s" on public.%1$I', t);
    execute format('create policy "staff write %1$s" on public.%1$I for all using (public.can_edit() or public.can_sell()) with check (public.can_edit() or public.can_sell())', t);
  end loop;
  -- log every change to these tables
  foreach t in array array['content', 'media', 'posts', 'testimonials', 'faqs', 'team', 'projects', 'products', 'settings', 'staff'] loop
    execute format('drop trigger if exists %1$s_activity on public.%1$I', t);
    execute format('create trigger %1$s_activity after insert or update or delete on public.%1$I for each row execute function public.log_activity()', t);
  end loop;
end $$;

-- Inquiries: visitors' new ones aren't logged (only staff edits and deletes).
drop trigger if exists inquiries_activity on public.inquiries;
create trigger inquiries_activity after update or delete on public.inquiries
  for each row execute function public.log_activity();

drop policy if exists "anyone reads published posts" on public.posts;
create policy "anyone reads published posts" on public.posts for select
  using ((status = 'published' and published_at <= now()) or public.is_staff());

-- Replace the admin-only rules from 01-schema.sql with role-based ones.
drop policy if exists "admins write settings" on public.settings;
drop policy if exists "admins write products" on public.products;
drop policy if exists "admins write projects" on public.projects;
drop policy if exists "anyone reads published products" on public.products;
create policy "anyone reads published products" on public.products for select using (published or public.is_staff());
drop policy if exists "anyone reads published projects" on public.projects;
create policy "anyone reads published projects" on public.projects for select using (published or public.is_staff());
drop policy if exists "admins manage inquiries" on public.inquiries;
drop policy if exists "sales manage inquiries" on public.inquiries;
create policy "sales manage inquiries" on public.inquiries for all
  using (public.can_sell()) with check (public.can_sell());

drop policy if exists "site: admins upload" on storage.objects;
drop policy if exists "site: admins update" on storage.objects;
drop policy if exists "site: admins delete" on storage.objects;
drop policy if exists "site: staff upload" on storage.objects;
create policy "site: staff upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'site' and (public.can_edit() or public.can_sell()));
drop policy if exists "site: staff update" on storage.objects;
create policy "site: staff update" on storage.objects for update to authenticated
  using (bucket_id = 'site' and (public.can_edit() or public.can_sell()));
drop policy if exists "site: staff delete" on storage.objects;
create policy "site: staff delete" on storage.objects for delete to authenticated
  using (bucket_id = 'site' and (public.can_edit() or public.can_sell()));

-- ---------------------------- Grants ----------------------------
grant select on public.content, public.media, public.posts, public.testimonials, public.faqs, public.team to anon, authenticated;
grant select, insert, update, delete on public.content, public.media, public.posts, public.testimonials, public.faqs, public.team, public.staff to authenticated;
grant select on public.activity to authenticated;

-- Photos already uploaded through the portal join the media library.
insert into public.media (path, name)
  select o.name, regexp_replace(o.name, '^.*/', '') from storage.objects o
  where o.bucket_id = 'site' on conflict (path) do nothing;

-- ---------------------------- Starting FAQs ----------------------------
insert into public.faqs (question, answer, topic, sort)
select * from (values
  ('How do I order rice?', 'Use the order form on the Pishori Rice page, call us, or send a WhatsApp message with the bag size and how many bags you need. We call back to confirm the price, place and time.', 'Rice', 1),
  ('Where do you deliver?', 'We deliver across [Delivery areas]. Ask us about other places.', 'Rice', 2),
  ('How do I pay?', '[Payment options, e.g. M-Pesa on delivery or bank transfer for institutions]', 'Rice', 3),
  ('Do you supply institutions on LPO / LSO?', 'Yes. Send us your requirements and we will quote, then deliver on the schedule you set, with delivery notes and invoices.', 'Supplies', 4),
  ('Can you share company documents for a tender?', 'Yes. Ask us for the certificate of incorporation, KRA PIN and tax compliance certificate and our company profile.', 'General', 5)
) as v(question, answer, topic, sort)
where not exists (select 1 from public.faqs);
