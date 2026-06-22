import { NextResponse } from "next/server";
import { processPendingSyncs } from "@/lib/sheets/sync";
import { getAuthContext } from "@/lib/supabase/auth";
import { logAudit } from "@/lib/audit";

export async function POST() {
  const ctx = await getAuthContext();
  if (!ctx || ctx.profile.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await processPendingSyncs();
    // Fire audit without blocking the response
    logAudit({ actorId: ctx.userId, action: "sync.forced", metadata: result });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
