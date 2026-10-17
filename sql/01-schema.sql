-- ============================================================
-- KANAM LOGISTICS LIMITED — website and staff portal
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- settings   : the company details the site shows (phone, email...), key/value
-- products   : rice (and other goods) with sizes and prices
-- projects   : work done — road works, supplies & delivery, rice trading
-- inquiries  : orders and quote requests sent from the site's forms
-- admins     : who may use the portal (see the last section)
--
-- Visitors can read the published products and projects and the settings,
-- and can send an inquiry — nothing else. Only admins can change anything
-- or read inquiries.
-- ============================================================

-- ---------------------------- Admins ----------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

drop policy if exists "admins read themselves" on public.admins;
create policy "admins read themselves" on public.admins for select
  using (user_id = auth.uid());

-- ---------------------------- Settings ----------------------------
create table if not exists public.settings (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.settings enable row level security;
drop policy if exists "anyone reads settings" on public.settings;
create policy "anyone reads settings" on public.settings for select using (true);
drop policy if exists "admins write settings" on public.settings;
create policy "admins write settings" on public.settings for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------- Products ----------------------------
create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  size_kg     numeric,
  price       integer,                 -- KES; null shows "Call for price"
  description text not null default '',
  in_stock    boolean not null default true,
  published   boolean not null default true,
  image_path  text,                    -- in the "site" storage bucket
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.products enable row level security;
drop policy if exists "anyone reads published products" on public.products;
create policy "anyone reads published products" on public.products for select
  using (published or public.is_admin());
drop policy if exists "admins write products" on public.products;
create policy "admins write products" on public.products for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------- Projects ----------------------------
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  category    text not null default 'Road works'
              check (category in ('Road works', 'Supplies & delivery', 'Rice trading')),
  client      text not null default '',
  location    text not null default '',
  year        text not null default '',
  description text not null default '',
  published   boolean not null default true,
  image_path  text,
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.projects enable row level security;
drop policy if exists "anyone reads published projects" on public.projects;
create policy "anyone reads published projects" on public.projects for select
  using (published or public.is_admin());
drop policy if exists "admins write projects" on public.projects;
create policy "admins write projects" on public.projects for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------- Inquiries ----------------------------
create table if not exists public.inquiries (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind       text not null default 'Other'
             check (kind in ('Rice order', 'Supplies & delivery', 'Road works', 'Other')),
  name       text not null check (char_length(name) between 1 and 120),
  phone      text not null check (char_length(phone) between 7 and 30),
  email      text not null default '' check (char_length(email) <= 200),
  product    text not null default '' check (char_length(product) <= 120),
  quantity   text not null default '' check (char_length(quantity) <= 60),
  message    text not null default '' check (char_length(message) <= 3000),
  status     text not null default 'new' check (status in ('new', 'contacted', 'done')),
  notes      text not null default ''
);
create index if not exists inquiries_created_idx on public.inquiries (created_at desc);
alter table public.inquiries enable row level security;
-- Visitors may only add a new inquiry; they can never read one back.
drop policy if exists "anyone sends an inquiry" on public.inquiries;
create policy "anyone sends an inquiry" on public.inquiries for insert
  to anon, authenticated with check (status = 'new' and notes = '');
drop policy if exists "admins manage inquiries" on public.inquiries;
create policy "admins manage inquiries" on public.inquiries for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------- Grants ----------------------------
grant select on public.settings, public.products, public.projects to anon, authenticated;
grant insert on public.inquiries to anon, authenticated;
grant select, insert, update, delete on public.settings, public.products, public.projects, public.inquiries to authenticated;
grant select on public.admins to authenticated;

-- ---------------------------- Photos ----------------------------
-- Public bucket: anyone can view the pictures, only admins can upload or delete.
insert into storage.buckets (id, name, public) values ('site', 'site', true)
  on conflict (id) do update set public = true;
drop policy if exists "site: admins upload" on storage.objects;
create policy "site: admins upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'site' and public.is_admin());
drop policy if exists "site: admins update" on storage.objects;
create policy "site: admins update" on storage.objects for update to authenticated
  using (bucket_id = 'site' and public.is_admin());
drop policy if exists "site: admins delete" on storage.objects;
create policy "site: admins delete" on storage.objects for delete to authenticated
  using (bucket_id = 'site' and public.is_admin());

-- ---------------------------- Starting content ----------------------------
-- The three Pishori bags from Batch 1 (prices from the trading ledger).
insert into public.products (name, size_kg, price, description, sort)
select * from (values
  ('Pishori rice', 5::numeric, 750, 'Aromatic Pishori rice, sorted and packed.', 1),
  ('Pishori rice', 10::numeric, 1500, 'Aromatic Pishori rice, sorted and packed.', 2),
  ('Pishori rice', 25::numeric, 3700, 'Aromatic Pishori rice, sorted and packed. Best value for families and shops.', 3)
) as v(name, size_kg, price, description, sort)
where not exists (select 1 from public.products);

-- ---------------------------- Your admin login ----------------------------
-- 1. Authentication -> Users -> Add user (your email and a password).
-- 2. Put that email below and run just this statement:
-- insert into public.admins (user_id)
--   select id from auth.users where email = 'you@example.com'
--   on conflict do nothing;
