"use client";

import type { PresenceUser } from "@/lib/supabase/usePresence";

type Props = {
  users: PresenceUser[];
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  if (mins < 60) return `${mins} mins ago`;
  const hrs = Math.floor(mins / 60);
  return hrs === 1 ? "1 hr ago" : `${hrs} hrs ago`;
}

/** Renders inside a parent `.panel` (the admin sidebar) -- this is a section
 * within it, not a panel of its own, so it stays unstyled at the outer level
 * to avoid a card nested inside a card. */
export function ActiveUsersPanel({ users }: Props) {
  return (
    <div className="panel-section">
      <div className="panel-header">
        <strong>Active Now</strong>
        <span className="presence-count">{users.length}</span>
      </div>

      {users.length === 0 ? (
        <div className="presence-empty">No team members are online right now.</div>
      ) : (
        <ul className="presence-list">
          {users.map((user) => (
            <li key={user.user_id} className="presence-item">
              <div className="presence-user">
                <span className={`presence-avatar ${user.role === "admin" ? "admin" : "team"}`}>
                  {user.display_name.slice(0, 1).toUpperCase()}
                </span>
                <div className="presence-user-text">
                  <p className="presence-name">{user.display_name}</p>
                  <p className="presence-team">{user.team_name}</p>
                </div>
              </div>

              <div className="presence-meta">
                <span className={user.role === "admin" ? "status synced" : "status pending"}>
                  {user.role === "admin" ? "Admin" : "Team"}
                </span>
                <span className="presence-time">{timeAgo(user.joined_at)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
