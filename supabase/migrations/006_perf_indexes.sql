-- Performance indexes added after profiling.
-- The audit_logs table was missing an index on created_at, which makes the
-- ORDER BY created_at DESC LIMIT 50 query do a full seq-scan as the table grows.
-- The sync_queue was also missing a composite index that matches the query
-- pattern used in processPendingSyncs.

create index if not exists audit_logs_created_at_idx
  on public.audit_logs(created_at desc);

-- trips: compound index for the admin dashboard's common filter pattern
-- (filter by team, order by travel_date)
create index if not exists trips_team_travel_date_idx
  on public.trips(team_id, travel_date asc);

-- sync_queue: the pending-items query filters on status='PENDING' and
-- run_after <= now(), then orders by created_at. The existing index covers
-- (status, run_after) but not created_at, so add it.
create index if not exists sync_queue_pending_created_idx
  on public.sync_queue(status, run_after, created_at asc)
  where status = 'PENDING';
