"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import type { Profile } from "@/types/trip";

export type PresenceUser = {
  user_id: string;
  display_name: string;
  team_name: string;
  role: "admin" | "team";
  joined_at: string; // ISO string set once on subscribe
};

const CHANNEL = "pprl-dashboard-presence";

/**
 * Joins the shared presence channel and broadcasts the current user's info.
 * Every logged-in dashboard user (admin + team) should call this hook.
 *
 * Keying the channel on `profile.id` means multiple browser tabs from the
 * same user merge into a single presence entry — the admin won't see the
 * same person listed twice when they have two tabs open.
 *
 * Returns the live list of all active users. Admin dashboard renders it;
 * team dashboards can safely ignore the return value.
 */
export function usePresence(profile: Profile, teamName: string): PresenceUser[] {
  const [activeUsers, setActiveUsers] = useState<PresenceUser[]>([]);

  useEffect(() => {
    const supabase = createClient();

    // Keying by user ID collapses multiple tabs into one presence slot.
    const channel = supabase.channel(CHANNEL, {
      config: { presence: { key: profile.id } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<PresenceUser>();
        // presenceState returns { [key]: PresenceUser[] } — flatten all slots.
        setActiveUsers(Object.values(state).flat());
      })
      .subscribe(async (status) => {
        if (status !== "SUBSCRIBED") return;
        await channel.track({
          user_id: profile.id,
          display_name: profile.full_name || profile.email,
          team_name: teamName,
          role: profile.role,
          joined_at: new Date().toISOString(),
        });
      });

    return () => {
      supabase.removeChannel(channel);
    };
  // profile.id is stable for the lifetime of a session — this runs once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

  return activeUsers;
}
