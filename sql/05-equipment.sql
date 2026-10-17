-- ============================================================
-- KANAM LOGISTICS — Machinery for hire (grader, excavator...) with rates,
-- shown on the Services page and edited in the portal (Machinery hire).
-- Also lets the website's quote form send "Machinery hire" requests.
-- Run after 02-cms.sql, in the Supabase SQL editor. Safe to re-run.
-- ============================================================

create table if not exists public.equipment (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                     -- e.g. "Motor grader"
  description text not null default '',
  rate        numeric,                           -- empty = "Call for rates"
  rate_unit   text not null default 'per hour',  -- per hour / per day / per week / per month
  terms       text not null default '',          -- e.g. "With operator. Fuel by client. Minimum 8 hours."
  status      text not null default 'available' check (status in ('available', 'on_hire', 'coming_soon')),
  image_path  text,                              -- in the "site" storage bucket
  published   boolean not null default true,
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.equipment enable row level security;

drop policy if exists "anyone reads published equipment" on public.equipment;
create policy "anyone reads published equipment" on public.equipment for select
  using (published or public.is_staff());
drop policy if exists "staff write equipment" on public.equipment;
create policy "staff write equipment" on public.equipment for all
  using (public.can_edit() or public.can_sell()) with check (public.can_edit() or public.can_sell());

grant select on public.equipment to anon, authenticated;
grant insert, update, delete on public.equipment to authenticated;

drop trigger if exists equipment_activity on public.equipment;
create trigger equipment_activity after insert or update or delete on public.equipment
  for each row execute function public.log_activity();

-- The quote form's new choice.
alter table public.inquiries drop constraint if exists inquiries_kind_check;
alter table public.inquiries add constraint inquiries_kind_check
  check (kind in ('Rice order', 'Supplies & delivery', 'Road works', 'Machinery hire', 'Other'));

-- Starting machines (only if there are none yet). Rates are left empty
-- ("Call for rates") until they are set in the portal.
insert into public.equipment (name, description, rate_unit, terms, status, sort)
select * from (values
  ('Motor grader', 'For grading and reshaping roads, levelling sites and murram spreading.', 'per hour',
   'With operator. Fuel by client. Transport to site charged separately.', 'available', 1),
  ('Excavator', 'For digging, trenching, loading, drainage and culvert works.', 'per hour',
   'With operator. Fuel by client. Transport to site charged separately.', 'coming_soon', 2)
) as v(name, description, rate_unit, terms, status, sort)
where not exists (select 1 from public.equipment);
