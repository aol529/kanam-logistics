-- ============================================================
-- KANAM LOGISTICS — Road works ledger: projects (a road / contract, what
-- the client pays, withholding tax, fuel prices, the standard days) and
-- their day-by-day cost log (each line is quantity × price).
-- Run after 02-cms.sql, in the Supabase SQL editor. Safe to re-run.
--
-- Private to staff with the admin or sales role, like the rice ledger.
-- Every change is written to the activity log.
-- ============================================================

create table if not exists public.road_projects (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,                  -- e.g. "Kanyamedha–Ombeyi road (KERRA)"
  client          text not null default 'KERRA',
  status          text not null default 'active' check (status in ('active', 'closed')),
  started_on      date,
  contract_amount numeric not null default 0,     -- what the client pays for the whole job
  wht_rate        numeric not null default 3,     -- withholding tax, % of each payment
  -- payments from the client: [{ "date": "2026-11-30", "label": "Certificate 1", "gross": 500000, "rate": 3 }, ...]
  payments        jsonb not null default '[]',
  diesel_price    numeric not null default 0,     -- per litre: grader, lorries, excavator
  petrol_price    numeric not null default 0,     -- per litre: the Probox
  -- the lines "Add a work day / murram day / bush clearing" put in the log:
  -- { "day": [{ "category": "Crew", "item": "Operator allowance", "unit": "", "qty": 1, "price": 5000, "fuel": "" }, ...], "murram": [...], "clearing": [...] }
  -- empty = the portal's standard lines
  templates       jsonb not null default '{}',
  notes           text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.road_projects enable row level security;

create table if not exists public.road_costs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.road_projects(id) on delete cascade,
  spent_on    date not null default current_date,
  category    text not null default 'Other',      -- Probox, Crew, Grader fuel, Grader upkeep, Security, Murram pit, Lorries...
  item        text not null default '',
  unit        text not null default '',           -- litres, trips, hours, lorries, people...
  qty         numeric,
  price       numeric,                            -- per unit; amount = qty × price
  notes       text not null default '',
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists road_costs_project_idx on public.road_costs (project_id, spent_on);
alter table public.road_costs enable row level security;

drop policy if exists "sales staff manage road projects" on public.road_projects;
create policy "sales staff manage road projects" on public.road_projects for all
  using (public.can_sell()) with check (public.can_sell());
drop policy if exists "sales staff manage road costs" on public.road_costs;
create policy "sales staff manage road costs" on public.road_costs for all
  using (public.can_sell()) with check (public.can_sell());

grant select, insert, update, delete on public.road_projects, public.road_costs to authenticated;
revoke all on public.road_projects, public.road_costs from anon;

drop trigger if exists road_projects_activity on public.road_projects;
create trigger road_projects_activity after insert or update or delete on public.road_projects
  for each row execute function public.log_activity();
drop trigger if exists road_costs_activity on public.road_costs;
create trigger road_costs_activity after insert or update or delete on public.road_costs
  for each row execute function public.log_activity();
