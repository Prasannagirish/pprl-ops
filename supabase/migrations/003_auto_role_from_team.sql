-- Removes the manual, error-prone step of typing `role` by hand on every
-- profile insert. From now on, role is derived automatically from team_id:
--   - team_id = PPRL  -> role is forced to 'admin'
--   - team_id = any other team -> role is forced to 'team'
--   - team_id is null -> role is left as whatever you explicitly set
--     (this is the only way to create a "floating" admin not labelled
--     under any team, if you ever want one; not needed for normal use)
--
-- This means it is no longer possible to end up with a PPRL-labelled
-- profile that isn't actually an admin, or a non-PPRL profile that
-- somehow has admin rights -- the two columns can't drift apart anymore.

create or replace function public.sync_profile_role()
returns trigger
language plpgsql
as $$
declare
  pprl_id uuid;
begin
  if new.team_id is not null then
    select id into pprl_id from public.teams where name = 'PPRL';

    if new.team_id = pprl_id then
      new.role := 'admin';
    else
      new.role := 'team';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_sync_role on public.profiles;
create trigger profiles_sync_role
before insert or update on public.profiles
for each row execute function public.sync_profile_role();

-- ---------------------------------------------------------------------
-- Provisioning is now simpler -- you only need to pick the right team_id,
-- role is filled in for you:
--
--   insert into public.profiles (id, team_id, full_name, email)
--   values (
--     '<new-auth-user-uuid>',
--     (select id from public.teams where name = 'PPRL'),
--     'Girish (PPRL Admin)',
--     'girish.admin@nitt.com'
--   );
--
--   insert into public.profiles (id, team_id, full_name, email)
--   values (
--     '<new-auth-user-uuid>',
--     (select id from public.teams where name = 'INFO'),
--     'Devansh',
--     'devansh.info@nitt.com'
--   );
--
-- Each of these still needs its own distinct Supabase Auth user (its own
-- UUID) -- one login = one profile = one role. You can't reuse a UUID
-- that already has a profile attached to give that same login a second
-- role; create a new Auth user instead.
-- ---------------------------------------------------------------------
