# PPRL Ops

Team travel operations console — buffer calculation and Google Sheets sync.

## Multi-POC Team Access (no per-user accounts)

**Problem solved:** When 6 POCs from the same team all need to submit guest details, creating 6 individual Supabase Auth accounts is friction-heavy and unreliable.

**Solution — Team Access Codes:**
- Admin creates **one shared Supabase Auth user** per team (e.g. `team-tc@pprl.internal`) via the Supabase dashboard, with `role = team` in `profiles`.
- Admin sets a **shared PIN** for that team via the "Team Access Codes" panel in the admin dashboard.
- All POCs on that team go to the **"Team access" tab** on the login page and enter: Team Code (e.g. `TC`) + PIN + their own name.
- The server verifies the PIN and issues a Supabase session as that team's shared user. No one ever sees the underlying email/password.
- The POC's name is shown in the header as a badge so teammates know who is active.

To reset a PIN, the admin simply enters a new one in the Team Access Codes panel. To lock a team out, toggle the code off.

## Setup

```bash
cp .env.example .env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
# Optionally set TEAM_SHARED_PASSWORD (default: pprl-shared-team-secret-2025)
npm install
npm run dev
```

## Database migrations

Run in order:
1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_org_teams_and_admin.sql`
3. `supabase/migrations/003_auto_role_from_team.sql`
4. `supabase/migrations/004_team_access_codes.sql`

## Provisioning a shared team user (one-time per team)

1. In Supabase dashboard → Authentication → Users → **Add user**
   - Email: `team-tc@pprl.internal` (or any internal address)
   - Password: value of `TEAM_SHARED_PASSWORD` env var
2. In SQL editor, insert a profile:
   ```sql
   insert into public.profiles (id, team_id, full_name, email)
   values (
     '<auth-user-uuid>',
     (select id from public.teams where name = 'TC'),
     'TC Shared Account',
     'team-tc@pprl.internal'
   );
   ```
   (Role is set automatically to `team` by the trigger.)
3. In the admin dashboard → Team Access Codes panel, select `TC`, enter the shared email and a PIN → Save.
4. Done — all TC POCs can now log in from the Team Access tab.
