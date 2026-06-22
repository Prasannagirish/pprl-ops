import { createAdminClient } from "@/lib/supabase/admin";

type AuditInput = {
  actorId?: string;
  teamId?: string | null;
  tripId?: string | null;
  action: string;
  metadata?: Record<string, unknown>;
};

export async function logAudit(input: AuditInput) {
  try {
    const supabase = createAdminClient();
    await supabase.from("audit_logs").insert({
      actor_id: input.actorId || null,
      team_id: input.teamId || null,
      trip_id: input.tripId || null,
      action: input.action,
      metadata: input.metadata || {}
    });
  } catch {
    // Audit logging should not block the primary workflow.
  }
}
