-- ============================================================
-- KANAM LOGISTICS — Company profile: the tender documents
-- (incorporation, CR12, KRA PIN & TCC, directors' IDs and CVs, trade
-- license, NCA, power of attorney, AGPO, litigation & affidavit, bank
-- statements, audited accounts, past experience).
-- Run after 02-cms.sql, in the Supabase SQL editor. Safe to re-run.
--
-- The files are PRIVATE: they live in the "profile" storage bucket, which
-- is not public, and only admins can list, open, upload or delete them.
-- The portal opens them with short-lived signed links.
-- ============================================================

-- One row per uploaded file. "section" is the checklist item (see
-- PROFILE_SECTIONS in js/portal.js), e.g. 'kra' or 'directors'.
create table if not exists public.company_docs (
  id          uuid primary key default gen_random_uuid(),
  section     text not null,
  title       text not null default '',     -- e.g. "Company TCC"
  path        text not null unique,         -- in the "profile" bucket
  name        text not null default '',     -- original file name
  mime        text not null default '',
  size        bigint,
  issued_on   date,
  expires_on  date,
  notes       text not null default '',
  uploaded_by uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists company_docs_section_idx on public.company_docs (section);
alter table public.company_docs enable row level security;

-- Per checklist item: mark it "not applicable" (e.g. AGPO) and keep notes.
create table if not exists public.company_profile (
  key            text primary key,
  not_applicable boolean not null default false,
  notes          text not null default '',
  updated_at     timestamptz not null default now()
);
alter table public.company_profile enable row level security;

insert into public.company_profile (key, not_applicable) values ('agpo', true)
  on conflict (key) do nothing;

drop policy if exists "admins manage company docs" on public.company_docs;
create policy "admins manage company docs" on public.company_docs for all
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins manage company profile" on public.company_profile;
create policy "admins manage company profile" on public.company_profile for all
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.company_docs, public.company_profile to authenticated;
revoke all on public.company_docs, public.company_profile from anon;

drop trigger if exists company_docs_activity on public.company_docs;
create trigger company_docs_activity after insert or update or delete on public.company_docs
  for each row execute function public.log_activity();
drop trigger if exists company_profile_activity on public.company_profile;
create trigger company_profile_activity after insert or update or delete on public.company_profile
  for each row execute function public.log_activity();

-- ---------------------------- Private storage ----------------------------
-- 25 MB per file; PDFs, photos/scans, Word and Excel.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile', 'profile', false, 26214400, array[
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "profile: admins read" on storage.objects;
create policy "profile: admins read" on storage.objects for select to authenticated
  using (bucket_id = 'profile' and public.is_admin());
drop policy if exists "profile: admins upload" on storage.objects;
create policy "profile: admins upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'profile' and public.is_admin());
drop policy if exists "profile: admins update" on storage.objects;
create policy "profile: admins update" on storage.objects for update to authenticated
  using (bucket_id = 'profile' and public.is_admin());
drop policy if exists "profile: admins delete" on storage.objects;
create policy "profile: admins delete" on storage.objects for delete to authenticated
  using (bucket_id = 'profile' and public.is_admin());
