-- Team Access Codes: allows multiple POCs to share a team login
-- without each needing their own Supabase Auth account.
-- Admin sets a PIN for a team; any POC uses teamCode + PIN to get a
-- session that behaves exactly like a normal team-role user.

create table if not exists public.team_access_codes (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  code_hash   text not null,          -- bcrypt hash of the PIN
  label       text not null default 'Shared access', -- human-readable note
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint  one_active_code_per_team unique (team_id)
);

create index if not exists team_access_codes_team_id_idx
  on public.team_access_codes(team_id);

-- Only admins can manage access codes.
alter table public.team_access_codes enable row level security;

drop policy if exists "admins can manage team_access_codes" on public.team_access_codes;
create policy "admins can manage team_access_codes"
  on public.team_access_codes
  for all
  using ((public.current_profile()).role = 'admin')
  with check ((public.current_profile()).role = 'admin');

-- The /api/team-login route uses the service-role key (admin client) to
-- look up the hash and issue a Supabase session for the team's shared
-- auth user, so no RLS needed for anon reads here.

-- Add trigger to keep updated_at fresh
drop trigger if exists team_access_codes_set_updated_at on public.team_access_codes;
create trigger team_access_codes_set_updated_at
  before update on public.team_access_codes
  for each row execute function public.set_updated_at();

-- shared_email: the Supabase Auth user the server signs in as when a team
-- POC authenticates via PIN. One shared auth account per team, created
-- once by the admin. The email never leaves the server (only readable via
-- service role key).
alter table public.team_access_codes
  add column if not exists shared_email text not null default '';
