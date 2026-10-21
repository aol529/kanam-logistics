-- ============================================================
-- KANAM LOGISTICS — a tender checklist that fits each company,
-- items of your own, and Rhodann Limited (eggs).
-- Run after 07-companies.sql, in the Supabase SQL editor. Safe to re-run.
--
-- companies.checklist : which documents its Company profile asks for —
--   'contractor' (roads & construction: NCA and the rest, as before),
--   'food' (eggs & produce: public health licence, food handlers'
--   medical certificates, veterinary & movement permits, farm
--   agreements; no NCA) or 'general' (neither).
-- company_profile rows marked custom are checklist items added by hand
-- in the portal (title, optional hint), shown after the built-in ones.
-- ============================================================

alter table public.companies add column if not exists checklist text not null default 'contractor';
alter table public.companies drop constraint if exists companies_checklist_check;
alter table public.companies add constraint companies_checklist_check
  check (checklist in ('contractor', 'food', 'general'));

alter table public.company_profile add column if not exists title  text    not null default '';
alter table public.company_profile add column if not exists hint   text    not null default '';
alter table public.company_profile add column if not exists custom boolean not null default false;
alter table public.company_profile add column if not exists sort   integer not null default 0;

-- Rhodann Limited: egg supply. Hidden from the website until
-- "Show on the website" is ticked under Companies.
insert into public.companies (id, name, short_name, what, checklist, published, sort)
  select 'rhodann', 'Rhodann Limited', 'Rhodann', 'Egg supply and distribution', 'food', false,
         coalesce(max(sort), 0) + 1
  from public.companies
on conflict (id) do nothing;
-- AGPO starts "not applicable", as for the other companies.
insert into public.company_profile (company, key, not_applicable)
  values ('rhodann', 'agpo', true) on conflict do nothing;
