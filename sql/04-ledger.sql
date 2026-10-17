-- ============================================================
-- KANAM LOGISTICS — Rice ledger: batches (purchase, costs, selling trips,
-- pricing) and their sales log. Same sheets as Pishori_Trading_Ledger.xlsx.
-- Run after 02-cms.sql, in the Supabase SQL editor. Safe to re-run.
--
-- Private to staff with the admin or sales role (not editors, not visitors).
-- Every change is written to the activity log.
-- ============================================================

create table if not exists public.rice_batches (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  status      text not null default 'active' check (status in ('active', 'closed')),
  started_on  date,
  -- [{ "size": 5, "bags": 50, "price": 700 }, ...]  price = your selling price per bag
  sizes       jsonb not null default '[]',
  price_kg    numeric not null default 0,       -- buying price of rice per kg
  price_bag   numeric not null default 0,       -- price per empty sack/bag
  -- other costs: [{ "label": "Transport: loading zone → Kisumu", "amount": 8000 }, ...]
  costs       jsonb not null default '[]',
  trips       integer not null default 0,       -- number of selling trips
  trip_costs  jsonb not null default '[]',      -- cost per trip: [{ "label": "Fuel", "amount": 3000 }, ...]
  target      numeric not null default 0,       -- profit target
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.rice_batches enable row level security;

create table if not exists public.rice_sales (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid not null references public.rice_batches(id) on delete cascade,
  sold_on       date not null default current_date,
  buyer         text not null default '',
  size_kg       numeric,
  bags          numeric,
  price_per_bag numeric,                        -- empty = the batch's price for that size
  paid          boolean not null default false,
  notes         text not null default '',
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists rice_sales_batch_idx on public.rice_sales (batch_id, sold_on);
alter table public.rice_sales enable row level security;

drop policy if exists "sales staff manage rice batches" on public.rice_batches;
create policy "sales staff manage rice batches" on public.rice_batches for all
  using (public.can_sell()) with check (public.can_sell());
drop policy if exists "sales staff manage rice sales" on public.rice_sales;
create policy "sales staff manage rice sales" on public.rice_sales for all
  using (public.can_sell()) with check (public.can_sell());

grant select, insert, update, delete on public.rice_batches, public.rice_sales to authenticated;
revoke all on public.rice_batches, public.rice_sales from anon;

drop trigger if exists rice_batches_activity on public.rice_batches;
create trigger rice_batches_activity after insert or update or delete on public.rice_batches
  for each row execute function public.log_activity();
drop trigger if exists rice_sales_activity on public.rice_sales;
create trigger rice_sales_activity after insert or update or delete on public.rice_sales
  for each row execute function public.log_activity();

-- Batch 1, as in the workbook (only if there are no batches yet).
insert into public.rice_batches (name, started_on, sizes, price_kg, price_bag, costs, trips, trip_costs, target)
select 'Batch 1 (Sirare → Kisumu, Oct 2026)', '2026-10-01',
  '[{"size":5,"bags":50,"price":700},{"size":10,"bags":100,"price":1400},{"size":25,"bags":50,"price":3300}]',
  113, 20,
  '[{"label":"Transport: packing site → loading zone","amount":16000},
    {"label":"Transport: loading zone → Kisumu","amount":8000},
    {"label":"Your fare to Sirare","amount":1000},
    {"label":"Your fare back","amount":1100},
    {"label":"Your lunch","amount":500},
    {"label":"Abaja – fare to Sirare","amount":1000},
    {"label":"Abaja – fare back","amount":1100},
    {"label":"Abaja – lunch","amount":500}]',
  6,
  '[{"label":"Fuel","amount":3000},{"label":"Your lunch","amount":500},{"label":"Abaja''s lunch","amount":500}]',
  20000
where not exists (select 1 from public.rice_batches);
