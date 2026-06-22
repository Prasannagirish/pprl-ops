create extension if not exists "pgcrypto";

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  disabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  team_id uuid references public.teams(id),
  role text not null check (role in ('admin', 'team')),
  full_name text,
  email text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_role_requires_team check (role = 'admin' or team_id is not null)
);

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id),
  guest_name text not null,
  guest_designation text,
  travel_date date not null,
  direction text not null check (direction in ('TO_CAMPUS', 'FROM_CAMPUS')),
  location_type text not null check (location_type in ('AIRPORT', 'RAILWAY', 'BUS_STAND', 'OTHER')),
  pickup_location text not null,
  drop_location text not null,
  flight_time timestamptz,
  pickup_time timestamptz,
  drop_time timestamptz,
  corrected_drop_time timestamptz,
  poc_name text not null,
  poc_contact text not null,
  guest_buffer_time timestamptz not null,
  poc_buffer_time timestamptz not null,
  sync_status text not null default 'PENDING' check (sync_status in ('PENDING', 'SYNCED', 'FAILED')),
  gsheet_row_id integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sync_queue (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  operation text not null default 'UPSERT' check (operation in ('UPSERT', 'DELETE')),
  status text not null default 'PENDING' check (status in ('PENDING', 'PROCESSING', 'SYNCED', 'FAILED')),
  attempts integer not null default 0,
  error_message text,
  run_after timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id),
  team_id uuid references public.teams(id),
  trip_id uuid references public.trips(id) on delete set null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists profiles_team_id_idx on public.profiles(team_id);
create index if not exists trips_team_id_idx on public.trips(team_id);
create index if not exists trips_travel_date_idx on public.trips(travel_date);
create index if not exists trips_sync_status_idx on public.trips(sync_status);
create index if not exists sync_queue_status_run_after_idx on public.sync_queue(status, run_after);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists trips_set_updated_at on public.trips;
create trigger trips_set_updated_at
before update on public.trips
for each row execute function public.set_updated_at();

create or replace function public.current_profile()
returns public.profiles
language sql
security definer
set search_path = public
stable
as $$
  select *
  from public.profiles
  where id = auth.uid()
  limit 1
$$;

alter table public.teams enable row level security;
alter table public.profiles enable row level security;
alter table public.trips enable row level security;
alter table public.sync_queue enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "admins can manage teams" on public.teams;
create policy "admins can manage teams"
on public.teams
for all
using ((public.current_profile()).role = 'admin')
with check ((public.current_profile()).role = 'admin');

drop policy if exists "teams can read own team" on public.teams;
create policy "teams can read own team"
on public.teams
for select
using (id = (public.current_profile()).team_id);

drop policy if exists "admins can manage profiles" on public.profiles;
create policy "admins can manage profiles"
on public.profiles
for all
using ((public.current_profile()).role = 'admin')
with check ((public.current_profile()).role = 'admin');

drop policy if exists "users can read own profile" on public.profiles;
create policy "users can read own profile"
on public.profiles
for select
using (id = auth.uid());

drop policy if exists "admins can manage trips" on public.trips;
create policy "admins can manage trips"
on public.trips
for all
using ((public.current_profile()).role = 'admin')
with check ((public.current_profile()).role = 'admin');

drop policy if exists "teams can manage own trips" on public.trips;
create policy "teams can manage own trips"
on public.trips
for all
using (team_id = (public.current_profile()).team_id)
with check (team_id = (public.current_profile()).team_id);

drop policy if exists "admins can read sync queue" on public.sync_queue;
create policy "admins can read sync queue"
on public.sync_queue
for select
using ((public.current_profile()).role = 'admin');

drop policy if exists "users can enqueue own trip syncs" on public.sync_queue;
create policy "users can enqueue own trip syncs"
on public.sync_queue
for insert
with check (
  exists (
    select 1
    from public.trips
    where trips.id = sync_queue.trip_id
      and (
        (public.current_profile()).role = 'admin'
        or trips.team_id = (public.current_profile()).team_id
      )
  )
);

drop policy if exists "admins can read audit logs" on public.audit_logs;
create policy "admins can read audit logs"
on public.audit_logs
for select
using ((public.current_profile()).role = 'admin');
