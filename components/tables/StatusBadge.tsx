import type { SyncStatus } from "@/types/trip";

export function StatusBadge({ status }: { status: SyncStatus }) {
  const className =
    status === "SYNCED" ? "status synced" : status === "FAILED" ? "status failed" : "status pending";

  return <span className={className}>{status}</span>;
}
