create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cabs (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.driver_daily_roster (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  roster_date date not null,
  available boolean not null default true,
  cab_id uuid references public.cabs(id),
  substituting_for_driver_id uuid references public.drivers(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (driver_id, roster_date)
);

alter table public.trips
  add column if not exists drivers_required smallint not null default 1
    check (drivers_required in (1, 2));

create table if not exists public.driver_trip_assignments (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  roster_date date not null,
  source text not null check (source in ('solver', 'manual')),
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  unique (trip_id, driver_id)
);

create table if not exists public.schedule_runs (
  id uuid primary key default gen_random_uuid(),
  roster_date date not null,
  status text not null default 'QUEUED' check (status in ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  triggered_by text not null check (triggered_by in ('auto', 'manual')),
  unassigned_trip_ids jsonb not null default '[]'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.location_duration_cache (
  id uuid primary key default gen_random_uuid(),
  origin text not null,
  destination text not null,
  duration_minutes integer not null,
  fetched_at timestamptz not null default now(),
  unique (origin, destination)
);

create index if not exists driver_daily_roster_roster_date_idx on public.driver_daily_roster(roster_date);
create index if not exists driver_trip_assignments_roster_date_idx on public.driver_trip_assignments(roster_date);
create index if not exists driver_trip_assignments_trip_id_idx on public.driver_trip_assignments(trip_id);
create index if not exists schedule_runs_status_idx on public.schedule_runs(status);
create index if not exists schedule_runs_roster_date_idx on public.schedule_runs(roster_date);

drop trigger if exists drivers_set_updated_at on public.drivers;
create trigger drivers_set_updated_at
before update on public.drivers
for each row execute function public.set_updated_at();

drop trigger if exists cabs_set_updated_at on public.cabs;
create trigger cabs_set_updated_at
before update on public.cabs
for each row execute function public.set_updated_at();

drop trigger if exists driver_daily_roster_set_updated_at on public.driver_daily_roster;
create trigger driver_daily_roster_set_updated_at
before update on public.driver_daily_roster
for each row execute function public.set_updated_at();

alter table public.drivers enable row level security;
alter table public.cabs enable row level security;
alter table public.driver_daily_roster enable row level security;
alter table public.driver_trip_assignments enable row level security;
alter table public.schedule_runs enable row level security;
alter table public.location_duration_cache enable row level security;

drop policy if exists "admins can manage drivers" on public.drivers;
create policy "admins can manage drivers"
on public.drivers
for all
using ((public.current_profile()).role = 'admin')
with check ((public.current_profile()).role = 'admin');

drop policy if exists "admins can manage cabs" on public.cabs;
create policy "admins can manage cabs"
on public.cabs
for all
using ((public.current_profile()).role = 'admin')
with check ((public.current_profile()).role = 'admin');

drop policy if exists "admins can manage driver roster" on public.driver_daily_roster;
create policy "admins can manage driver roster"
on public.driver_daily_roster
for all
using ((public.current_profile()).role = 'admin')
with check ((public.current_profile()).role = 'admin');

drop policy if exists "admins can manage driver trip assignments" on public.driver_trip_assignments;
create policy "admins can manage driver trip assignments"
on public.driver_trip_assignments
for all
using ((public.current_profile()).role = 'admin')
with check ((public.current_profile()).role = 'admin');

drop policy if exists "admins can manage schedule runs" on public.schedule_runs;
create policy "admins can manage schedule runs"
on public.schedule_runs
for all
using ((public.current_profile()).role = 'admin')
with check ((public.current_profile()).role = 'admin');

drop policy if exists "admins can manage location duration cache" on public.location_duration_cache;
create policy "admins can manage location duration cache"
on public.location_duration_cache
for all
using ((public.current_profile()).role = 'admin')
with check ((public.current_profile()).role = 'admin');
