"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/browser";
import type { Team, Trip } from "@/types/trip";

type RawTripRow = Omit<Trip, "teams">;

type TripChangeHandlers = {
  onInsert: (trip: Trip) => void;
  onUpdate: (trip: Trip) => void;
  onDelete: (tripId: string) => void;
};

/**
 * Subscribes to live INSERT/UPDATE/DELETE events on the trips table.
 *
 * Realtime respects the same Row Level Security policies as normal
 * queries: a team-role user only ever receives events for their own
 * team_id, and a PPRL admin receives events for every team. This is what
 * lets multiple people on the same team (or multiple PPRL admins) work
 * concurrently and see each other's changes without a manual reload.
 *
 * `teams` is used purely to attach the display-friendly team name to rows
 * coming off the wire, since Realtime payloads are raw table rows without
 * the joined `teams(id, name)` relation that the initial server-rendered
 * list includes.
 */
export function useTripsRealtime(teams: Team[], handlers: TripChangeHandlers) {
  const teamsRef = useRef(teams);
  teamsRef.current = teams;

  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const supabase = createClient();

    function hydrate(row: RawTripRow): Trip {
      const team = teamsRef.current.find((candidate) => candidate.id === row.team_id);
      return { ...row, teams: team ? { id: team.id, name: team.name } : null };
    }

    const channel = supabase
      .channel("trips-changes")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "trips" },
        (payload) => handlersRef.current.onInsert(hydrate(payload.new as RawTripRow))
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "trips" },
        (payload) => handlersRef.current.onUpdate(hydrate(payload.new as RawTripRow))
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "trips" },
        (payload) => handlersRef.current.onDelete((payload.old as { id: string }).id)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);
}
