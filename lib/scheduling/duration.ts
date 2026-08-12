import type { SupabaseClient } from "@supabase/supabase-js";
import { requiredEnv } from "@/lib/env";

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

async function fetchDurationFromGoogle(origin: string, destination: string): Promise<number> {
  const apiKey = requiredEnv("GOOGLE_MAPS_API_KEY");
  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", origin);
  url.searchParams.set("destinations", destination);
  url.searchParams.set("key", apiKey);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Distance Matrix request failed with status ${response.status}.`);
  }

  const payload = await response.json();
  const element = payload?.rows?.[0]?.elements?.[0];
  if (!element || element.status !== "OK" || !element.duration) {
    throw new Error(`Distance Matrix could not compute a route from "${origin}" to "${destination}".`);
  }

  return Math.ceil(element.duration.value / 60);
}

export async function getDurationMinutes(
  supabase: SupabaseClient,
  origin: string,
  destination: string
): Promise<number> {
  const normalizedOrigin = normalize(origin);
  const normalizedDestination = normalize(destination);

  const { data: cached } = await supabase
    .from("location_duration_cache")
    .select("duration_minutes")
    .eq("origin", normalizedOrigin)
    .eq("destination", normalizedDestination)
    .maybeSingle();

  if (cached) {
    return cached.duration_minutes;
  }

  const durationMinutes = await fetchDurationFromGoogle(origin, destination);

  await supabase.from("location_duration_cache").insert({
    origin: normalizedOrigin,
    destination: normalizedDestination,
    duration_minutes: durationMinutes
  });

  return durationMinutes;
}
