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
5. `supabase/migrations/005_event_config.sql`
6. `supabase/migrations/006_perf_indexes.sql`
7. `supabase/migrations/007_driver_scheduling.sql`

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

## Google Sheets setup (one-time)

The sync writes to a real Google Sheet using a service account, not a user's personal OAuth login, so it keeps working unattended.

1. In [Google Cloud Console](https://console.cloud.google.com), create (or reuse) a project, then enable the **Google Sheets API** for it.
2. Create a **Service Account** (IAM & Admin → Service Accounts), then create a **JSON key** for it and download it.
3. From that JSON, you need two values for env vars:
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL` → the `client_email` field
   - `GOOGLE_PRIVATE_KEY` → the `private_key` field (keep the `\n` escapes as-is; the app un-escapes them at runtime)
4. Create the destination Google Sheet, then **share it** with the service account's email (the `client_email` above) as an **Editor** — this step is easy to miss and is the #1 cause of "permission denied" sync failures.
5. Copy the spreadsheet ID from its URL (`https://docs.google.com/spreadsheets/d/<this-part>/edit`) into `GOOGLE_SHEETS_SPREADSHEET_ID`.

The app creates one tab per event day ("Day 0", "Day 1", ...) automatically the first time it syncs, based on the Day 0 date set in the admin dashboard — you don't need to pre-create tabs.

## Deploying

This is a standard Next.js app, so it deploys cleanly to Vercel (or any Node host).

1. **Supabase**: create a project, run the migrations above in order via the SQL editor.
2. **Google Sheets**: follow the section above to get a service account + spreadsheet.
3. **Push the repo to GitHub** (needed either way — Vercel deploys from git, and the auto-sync GitHub Action below also needs the repo there).
4. **Vercel**: import the repo as a new project. Set these environment variables in Project Settings → Environment Variables:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`
   - `APP_TIMEZONE` (e.g. `Asia/Kolkata`)
   - `TEAM_SHARED_PASSWORD`
   - `CRON_SECRET` — any random 16+ char string; this guards the auto-sync endpoint (see below)
   - `GOOGLE_MAPS_API_KEY` — Distance Matrix API key, used to estimate trip durations for driver scheduling
   - `SCHEDULER_SERVICE_URL`, `SCHEDULER_SERVICE_SECRET` — base URL and shared secret for the OR-Tools scheduler microservice (see `scheduler-service/README.md`)
   - Deploy.
5. **Provision teams and a shared user per team** as described above.
6. **Set up auto-sync** (see below) so trips land in the sheet without anyone clicking "Force Sync".

## Auto-sync

Trips are written to a `sync_queue` table as soon as they're created/edited, but something still has to drain that queue. There are two ways to do that automatically instead of an admin clicking "Force Sync" in the dashboard:

**`GET /api/cron/sync`** is a dedicated, unauthenticated-by-session endpoint built for this. It checks a shared secret instead of a login, so a scheduler can hit it directly:
```
Authorization: Bearer <CRON_SECRET>
```

Use **GitHub Actions** to call it on a schedule — `.github/workflows/auto-sync.yml` is already set up to hit the endpoint every 5 minutes, and it's free on any Vercel plan (Vercel's own built-in Cron Jobs require Pro for anything more frequent than once a day, which is too infrequent here, so this repo doesn't use `vercel.json` crons at all).

Set up:
1. Add two repo secrets under Settings → Secrets and variables → Actions:
   - `APP_URL` — your deployed URL, e.g. `https://pprl-ops.vercel.app`
   - `CRON_SECRET` — same value you set on Vercel
2. Push the workflow file to your default branch — it starts running on its own from then on.

You can change the cadence by editing the `cron:` line in that file — e.g. `*/2 * * * *` for every 2 minutes.

You can still trigger a manual sync any time from the admin dashboard's "Force Sync" button (`POST /api/sync`) — that path is unchanged and is independent of the scheduler.

## Driver scheduling

`GET /api/cron/schedule` drains queued driver-scheduling runs the same way `/api/cron/sync` drains the sheet sync queue — add a second scheduled job hitting this endpoint with the same `Authorization: Bearer <CRON_SECRET>` header (e.g. another line in `.github/workflows/auto-sync.yml`, or a second workflow file).

Admins manage the day's driver roster and review/override the resulting schedule from the "Driver Roster" and "Driver Schedule" panels in the admin dashboard. See `docs/superpowers/specs/2026-08-11-driver-cab-scheduling-design.md` for the full design.

