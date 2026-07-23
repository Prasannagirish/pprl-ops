import { CalendarDays, Clock, PlaneLanding, PlaneTakeoff } from "lucide-react";
import type { Trip } from "@/types/trip";

function isToday(date: string) {
  const today = new Date().toISOString().slice(0, 10);
  return date === today;
}

export function AnalyticsCards({ trips }: { trips: Trip[] }) {
  const airportPickups = trips.filter(
    (trip) => trip.location_type === "AIRPORT" && trip.direction === "TO_CAMPUS"
  ).length;
  const airportDrops = trips.filter(
    (trip) => trip.location_type === "AIRPORT" && trip.direction === "FROM_CAMPUS"
  ).length;
  const pending = trips.filter((trip) => trip.sync_status === "PENDING").length;
  const today = trips.filter((trip) => isToday(trip.travel_date)).length;

  const cards = [
    { label: "Total Trips", value: trips.length, icon: CalendarDays },
    { label: "Airport Pickups", value: airportPickups, icon: PlaneLanding },
    { label: "Airport Drops", value: airportDrops, icon: PlaneTakeoff },
    { label: "Pending Syncs", value: pending, icon: Clock },
    { label: "Today's Travel", value: today, icon: CalendarDays }
  ];

  return (
    <section className="grid metrics">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div className="metric" key={card.label}>
            <span>
              <Icon size={13} className="metric-icon" />
              {card.label}
            </span>
            <strong>{card.value}</strong>
          </div>
        );
      })}
    </section>
  );
}
