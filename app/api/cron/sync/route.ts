/**
 * GET /api/cron/sync
 *
 * Auto-sync entry point. This is the endpoint Vercel Cron (or any other
 * scheduler) hits on a fixed interval to drain the sync_queue, instead of
 * an admin having to click "Force Sync" by hand.
 *
 * Auth model is different from /api/sync on purpose: that route is for a
 * logged-in admin clicking a button in the dashboard, so it checks for an
 * admin session. This route has no human in the loop -- it's called by
 * the scheduler -- so it checks a shared secret instead.
 *
 * Vercel Cron automatically sends `Authorization: Bearer ${CRON_SECRET}`
 * on every cron-triggered request when CRON_SECRET is set as an env var,
 * so no extra wiring is needed beyond setting that variable. If you're
 * using a different scheduler (GitHub Actions, cron-job.org, Supabase
 * pg_cron + a webhook, etc.) just make sure it sends the same header.
 */

import { NextResponse } from "next/server";
import { processPendingSyncs } from "@/lib/sheets/sync";
import { logAudit } from "@/lib/audit";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processPendingSyncs();
    if (result.processed > 0) {
      logAudit({ action: "sync.auto", metadata: result });
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
