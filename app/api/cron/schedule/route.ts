/**
 * GET /api/cron/schedule
 *
 * Drains queued driver-scheduling runs (see schedule_runs), same
 * auth model as /api/cron/sync: a shared secret instead of a login,
 * because this is called by a scheduler, not a human.
 */

import { NextResponse } from "next/server";
import { processQueuedScheduleRuns } from "@/lib/scheduling/runner";
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
    const result = await processQueuedScheduleRuns();
    if (result.processed > 0) {
      logAudit({ action: "schedule.auto", metadata: result });
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scheduling failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
