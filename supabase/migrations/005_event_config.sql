-- Single source of truth for the actual calendar date of "Day 0".
-- Everything else (Day 1, Day 2, Day 3, and the sheet tab a trip lands on)
-- is derived from this one date, so admins only ever set it in one place.

create table if not exists public.event_config (
  id            smallint primary key default 1 check (id = 1), -- enforces a single row
  day_zero_date date not null,
  updated_at    timestamptz not null default now()
);

drop trigger if exists event_config_set_updated_at on public.event_config;
create trigger event_config_set_updated_at
before update on public.event_config
for each row execute function public.set_updated_at();

alter table public.event_config enable row level security;

drop policy if exists "admins can manage event_config" on public.event_config;
create policy "admins can manage event_config"
on public.event_config
for all
using ((public.current_profile()).role = 'admin')
with check ((public.current_profile()).role = 'admin');

-- Teams only need to read it (e.g. if the dashboard ever shows "Day 1" badges
-- next to a trip), they never set it.
drop policy if exists "teams can read event_config" on public.event_config;
create policy "teams can read event_config"
on public.event_config
for select
using (true);

-- Note: the sheets-sync worker reads this via the service-role admin client,
-- so RLS above only governs access from logged-in users in the app itself.
