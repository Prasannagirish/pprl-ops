-- Adds the real organisational teams, designates PPRL as the administrative
-- team, and enables Realtime so concurrently logged-in users (same team,
-- or multiple PPRL admins) see each other's trip changes live.

-- Distinguish operational teams (file trips) from the administrative team
-- (PPRL: global visibility, no trips filed against it in normal use).
alter table public.teams
  add column if not exists is_admin_team boolean not null default false;

-- Operational teams. Safe to re-run.
insert into public.teams (name)
values
  ('TC'),
  ('PET'),
  ('PWT'),
  ('INFO'),
  ('PMR'),
  ('PSR'),
  ('PQAT'),
  ('CFGL'),
  ('ESI'),
  ('PPT')
on conflict (name) do nothing;

-- PPRL is the administrative team. Profiles attached to it should be
-- created with role = 'admin' (see instructions below), which is what
-- actually grants global access via RLS -- team_id on an admin profile is
-- only used to label/group the account, exactly like any other team.
insert into public.teams (name, is_admin_team)
values ('PPRL', true)
on conflict (name) do update set is_admin_team = excluded.is_admin_team;

-- Enable Realtime on trips so the dashboard can subscribe to live
-- inserts/updates/deletes instead of relying on a manual page reload.
-- Realtime respects the existing RLS policies on the trips table, so a
-- team only ever receives change events for their own rows, and PPRL
-- admins receive events for every row.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trips'
  ) then
    alter publication supabase_realtime add table public.trips;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Enforce the "disabled" flag on teams: a disabled team's members can
-- still log in and see their history, but cannot create or edit new
-- trips. Admins are never affected by this flag. Previously `disabled`
-- was toggleable from the admin UI but nothing checked it -- this closes
-- that gap at the RLS layer (the API also checks it for a friendlier
-- error message, but RLS is the real backstop).
drop policy if exists "teams can manage own trips" on public.trips;

drop policy if exists "teams can read own trips" on public.trips;
create policy "teams can read own trips"
on public.trips
for select
using (team_id = (public.current_profile()).team_id);

drop policy if exists "teams can insert own trips" on public.trips;
create policy "teams can insert own trips"
on public.trips
for insert
with check (
  team_id = (public.current_profile()).team_id
  and not coalesce((select disabled from public.teams where id = team_id), false)
);

drop policy if exists "teams can update own trips" on public.trips;
create policy "teams can update own trips"
on public.trips
for update
using (team_id = (public.current_profile()).team_id)
with check (
  team_id = (public.current_profile()).team_id
  and not coalesce((select disabled from public.teams where id = team_id), false)
);

drop policy if exists "teams can delete own trips" on public.trips;
create policy "teams can delete own trips"
on public.trips
for delete
using (team_id = (public.current_profile()).team_id);

-- ---------------------------------------------------------------------
-- Provisioning additional users (run after creating the matching user in
-- Supabase Auth -- Authentication > Users > Add user):
--
--   -- Another concurrent user for an existing operational team, e.g. TC:
--   insert into public.profiles (id, team_id, role, full_name, email)
--   values (
--     '<new-auth-user-uuid>',
--     (select id from public.teams where name = 'TC'),
--     'team',
--     'Jane from TC',
--     'jane.tc@company.com'
--   );
--
--   -- Another concurrent PPRL admin:
--   insert into public.profiles (id, team_id, role, full_name, email)
--   values (
--     '<new-auth-user-uuid>',
--     (select id from public.teams where name = 'PPRL'),
--     'admin',
--     'Second PPRL Admin',
--     'admin2@company.com'
--   );
--
-- Any number of profiles can point at the same team_id (operational or
-- PPRL) -- that's what allows multiple people to be logged in and working
-- concurrently under the same team or under PPRL.
-- ---------------------------------------------------------------------
