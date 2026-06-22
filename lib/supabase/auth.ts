/**
 * Shared auth helpers for API routes.
 *
 * Every API route previously called getUser() then getProfile() serially
 * and independently — that's 2 round trips per request. These helpers
 * combine them and are structured so callers can run them alongside their
 * own DB queries with Promise.all.
 */
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/supabase/queries";
import type { Profile } from "@/types/trip";

export async function getAuthContext(): Promise<{ userId: string; profile: Profile } | null> {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return null;

  const profile = await getProfile(supabase, user.id);
  if (!profile) return null;

  return { userId: user.id, profile };
}

export async function requireAuthContext() {
  const ctx = await getAuthContext();
  return ctx; // callers check for null and return 401/403
}
