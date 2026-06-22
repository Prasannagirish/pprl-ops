"use client";

import { useEffect, useState } from "react";
import { AppHeader } from "@/components/dashboard/AppHeader";
import type { Profile } from "@/types/trip";

/**
 * Thin client wrapper that reads the POC label from sessionStorage
 * (set during team-access login) and passes it to AppHeader.
 */
export function AppHeaderClientWrapper({ profile }: { profile: Profile }) {
  const [pocLabel, setPocLabel] = useState<string | undefined>(undefined);

  useEffect(() => {
    const label = sessionStorage.getItem("poc_label");
    if (label) setPocLabel(label);
  }, []);

  return <AppHeader profile={profile} pocLabel={pocLabel} />;
}
