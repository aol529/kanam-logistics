-- ============================================================
-- KANAM LOGISTICS — "New here? Ask for access" on the portal sign-in.
-- Run after 08-checklists.sql, in the Supabase SQL editor. Safe to re-run.
--
-- Anyone can leave their email (and name, note) in access_requests;
-- only admins can read them, on the Staff page. Adding the person as
-- staff (or dismissing them) removes the request. Sign-ups stay off in
-- Supabase, so nobody gets in until an admin makes their login.
--
-- is_staff_email(email) tells the sign-in page whether an email belongs
-- to an active staff member, so an unknown email gets the "ask for access"
-- dialog instead of a "wrong password" error.
-- ============================================================

create table if not exists public.access_requests (
  id         uuid primary key default gen_random_uuid(),
  email      text not null check (char_length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name       text not null default '' check (char_length(name) <= 120),
  note       text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default now()
);
-- One request per email: asking twice doesn't pile up.
create unique index if not exists access_requests_email on public.access_requests (lower(email));
alter table public.access_requests enable row level security;

drop policy if exists "anyone asks for access" on public.access_requests;
create policy "anyone asks for access" on public.access_requests for insert
  to anon, authenticated with check (true);
drop policy if exists "admins manage access requests" on public.access_requests;
create policy "admins manage access requests" on public.access_requests for all
  using (public.is_admin()) with check (public.is_admin());

grant insert on public.access_requests to anon, authenticated;
grant select, delete on public.access_requests to authenticated;

create or replace function public.is_staff_email(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where lower(email) = lower(trim(p_email)) and active);
$$;
revoke all on function public.is_staff_email(text) from public;
grant execute on function public.is_staff_email(text) to anon, authenticated;
