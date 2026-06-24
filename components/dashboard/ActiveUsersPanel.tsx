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

export function ActiveUsersPanel({ users }: Props) {
  return (
    <div className="panel" style={{ marginTop: 0 }}>
      <div className="panel-header">
        <strong>Active Now</strong>
        <span
          style={{
            alignItems: "center",
            background: "var(--go-dim)",
            border: "1px solid var(--go-line)",
            borderRadius: 999,
            color: "var(--go)",
            display: "inline-flex",
            fontSize: 11,
            fontWeight: 600,
            gap: 5,
            padding: "2px 8px",
          }}
        >
          <span
            style={{
              background: "var(--go)",
              borderRadius: "50%",
              display: "inline-block",
              height: 6,
              width: 6,
            }}
          />
          {users.length}
        </span>
      </div>

      {users.length === 0 ? (
        <div className="panel-body" style={{ color: "var(--fog)", fontSize: 13 }}>
          No team members are online right now.
        </div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: "8px 0" }}>
          {users.map((user) => (
            <li
              key={user.user_id}
              style={{
                alignItems: "center",
                borderBottom: "1px solid var(--line-soft)",
                display: "flex",
                gap: 10,
                justifyContent: "space-between",
                padding: "9px 18px",
              }}
            >
              {/* Avatar + name */}
              <div style={{ alignItems: "center", display: "flex", gap: 9, minWidth: 0 }}>
                <span
                  style={{
                    alignItems: "center",
                    background: user.role === "admin" ? "var(--accent-dim)" : "var(--go-dim)",
                    border: `1px solid ${user.role === "admin" ? "var(--accent-line)" : "var(--go-line)"}`,
                    borderRadius: "50%",
                    color: user.role === "admin" ? "var(--accent)" : "var(--go)",
                    display: "inline-flex",
                    flexShrink: 0,
                    fontSize: 11,
                    fontWeight: 700,
                    height: 28,
                    justifyContent: "center",
                    width: 28,
                  }}
                >
                  {user.display_name.slice(0, 1).toUpperCase()}
                </span>
                <div style={{ minWidth: 0 }}>
                  <p
                    style={{
                      color: "var(--paper)",
                      fontSize: 13,
                      fontWeight: 500,
                      margin: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {user.display_name}
                  </p>
                  <p style={{ color: "var(--fog)", fontSize: 11, margin: 0 }}>
                    {user.team_name}
                  </p>
                </div>
              </div>

              {/* Role badge + time */}
              <div style={{ alignItems: "flex-end", display: "flex", flexDirection: "column", flexShrink: 0, gap: 3 }}>
                <span
                  className={user.role === "admin" ? "status synced" : "status pending"}
                  style={{ fontSize: 11 }}
                >
                  {user.role === "admin" ? "Admin" : "Team"}
                </span>
                <span style={{ color: "var(--dust)", fontSize: 11 }}>
                  {timeAgo(user.joined_at)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
