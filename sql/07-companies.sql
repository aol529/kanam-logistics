-- ============================================================
-- KANAM LOGISTICS — the group: Kanam Logistics and its sister companies
-- (Techpride Ventures Ltd, Nyamasaria Glassmart and General Hardwares).
-- Run after 06-roads.sql, in the Supabase SQL editor. Safe to re-run.
--
-- companies : one row per company. Kanam's own details stay in
--             "settings"; the others keep theirs here. A company is
--             hidden from the website until "published" is ticked in the
--             portal (Companies), e.g. once the handover is official.
-- Each project, inquiry, road project and tender document now belongs to
-- a company (default: kanam). The tender checklist (company_profile) is
-- kept per company.
-- ============================================================

create table if not exists public.companies (
  id              text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name            text not null,
  short_name      text not null default '',
  what            text not null default '',     -- one line: what the company does
  about           text not null default '',
  services        text not null default '',     -- one per line
  phone           text not null default '',
  whatsapp        text not null default '',
  email           text not null default '',
  location        text not null default '',
  postal          text not null default '',
  hours           text not null default '',
  reg_no          text not null default '',
  kra_pin         text not null default '',
  year_registered text not null default '',
  directors       text not null default '',
  logo_path       text,                         -- in the "site" storage bucket
  published       boolean not null default false,
  sort            integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.companies enable row level security;

drop policy if exists "anyone reads published companies" on public.companies;
create policy "anyone reads published companies" on public.companies for select
  using (published or public.is_staff());
drop policy if exists "admins write companies" on public.companies;
create policy "admins write companies" on public.companies for all
  using (public.is_admin()) with check (public.is_admin());
grant select on public.companies to anon, authenticated;
grant insert, update, delete on public.companies to authenticated;

drop trigger if exists companies_activity on public.companies;
create trigger companies_activity after insert or update or delete on public.companies
  for each row execute function public.log_activity();

-- Is this company on the website? (Kanam always is.)
create or replace function public.company_live(c text) returns boolean
language sql stable security definer set search_path = public as $$
  select c = 'kanam' or exists (select 1 from public.companies where id = c and published);
$$;
revoke all on function public.company_live(text) from public;
grant execute on function public.company_live(text) to anon, authenticated;

-- The three companies. The sister companies start hidden; details in
-- [square brackets] are placeholders to fill in from the portal.
insert into public.companies (id, name, short_name, what, about, services, location, reg_no, kra_pin, year_registered, directors, published, sort) values
  ('kanam', 'Kanam Logistics Limited', 'Kanam Logistics',
   'Institutional supplies, Pishori rice, rural road works and machinery hire.',
   '', '', '', '', '', '', '', true, 1),
  ('techpride', 'Techpride Ventures Ltd', 'Techpride Ventures',
   'Rural road contracts with KERRA, and the motor grader and excavator that Kanam Logistics hires out.',
   '[About Techpride Ventures: when it started, who runs it and the roads it has worked on.]',
   E'Rural road maintenance and construction (KERRA contracts)\nGrading, murram gravelling and bush clearing\nPlant and machinery: motor grader and excavator',
   '[Office location]', '[Company registration number]', '[KRA PIN]', '[Year registered]', '[Director names]', false, 2),
  ('glassmart', 'Nyamasaria Glassmart and General Hardwares', 'Nyamasaria Glassmart',
   'Glass, hardware and building supplies.',
   '[About Nyamasaria Glassmart: when it opened, what it stocks and who it serves.]',
   E'Glass cutting and fitting\nGeneral hardware\nBuilding and construction supplies',
   '[Shop location, e.g. Nyamasaria, Kisumu]', '[Company registration number]', '[KRA PIN]', '[Year registered]', '[Director names]', false, 3)
on conflict (id) do nothing;

-- ---------------------------- Who owns what ----------------------------
alter table public.projects      add column if not exists company text not null default 'kanam' references public.companies(id) on update cascade;
alter table public.inquiries     add column if not exists company text not null default 'kanam' references public.companies(id) on update cascade;
alter table public.road_projects add column if not exists company text not null default 'kanam' references public.companies(id) on update cascade;
alter table public.company_docs  add column if not exists company text not null default 'kanam' references public.companies(id) on update cascade;
alter table public.company_profile add column if not exists company text not null default 'kanam' references public.companies(id) on update cascade;

-- The tender checklist is per company: (company, key) instead of key.
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'company_profile_pkey'
             and conrelid = 'public.company_profile'::regclass and array_length(conkey, 1) = 1) then
    alter table public.company_profile drop constraint company_profile_pkey;
    alter table public.company_profile add constraint company_profile_pkey primary key (company, key);
  end if;
end $$;
-- AGPO starts "not applicable" for every company, as it did for Kanam.
insert into public.company_profile (company, key, not_applicable)
  select id, 'agpo', true from public.companies on conflict do nothing;

-- Projects of a hidden company stay off the website.
drop policy if exists "anyone reads published projects" on public.projects;
create policy "anyone reads published projects" on public.projects for select
  using ((published and public.company_live(company)) or public.is_staff());

-- A website inquiry can only go to a company that is on the website.
drop policy if exists "anyone sends an inquiry" on public.inquiries;
create policy "anyone sends an inquiry" on public.inquiries for insert
  to anon, authenticated with check (status = 'new' and notes = '' and public.company_live(company));

-- New choices: hardware projects and quote requests.
alter table public.projects drop constraint if exists projects_category_check;
alter table public.projects add constraint projects_category_check
  check (category in ('Road works', 'Supplies & delivery', 'Rice trading', 'Hardware & glass', 'Machinery hire'));
alter table public.inquiries drop constraint if exists inquiries_kind_check;
alter table public.inquiries add constraint inquiries_kind_check
  check (kind in ('Rice order', 'Supplies & delivery', 'Road works', 'Machinery hire', 'Hardware & glass', 'Other'));
