import { subMinutes } from "date-fns";
import type { CalculatedBuffers, TripInput } from "@/types/trip";

const AIRPORT_POC_BUFFER_MINUTES = 15;
const NORMAL_POC_BUFFER_MINUTES = 10;
const GUEST_BUFFER_MINUTES = 50;
const AIRPORT_DEPARTURE_DROP_LEAD_MINUTES = 150;

function requireDate(value: string | null | undefined, label: string): Date {
  if (!value) {
    throw new Error(`${label} is required for this trip type.`);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} must be a valid date/time.`);
  }

  return date;
}

export function calculateBuffers(data: TripInput): CalculatedBuffers {
  if (data.locationType === "AIRPORT") {
    const flightTime = requireDate(data.flightTime, "Flight time");

    if (data.direction === "FROM_CAMPUS") {
      const correctedDropTime = subMinutes(flightTime, AIRPORT_DEPARTURE_DROP_LEAD_MINUTES);
      const guestBuffer = subMinutes(correctedDropTime, GUEST_BUFFER_MINUTES);
      const pocBuffer = subMinutes(guestBuffer, AIRPORT_POC_BUFFER_MINUTES);

      return {
        correctedDropTime,
        guestBuffer,
        pocBuffer
      };
    }

    const guestBuffer = subMinutes(flightTime, GUEST_BUFFER_MINUTES);
    const pocBuffer = subMinutes(guestBuffer, AIRPORT_POC_BUFFER_MINUTES);

    return {
      guestBuffer,
      pocBuffer
    };
  }

  const baseTime =
    data.direction === "TO_CAMPUS"
      ? requireDate(data.pickupTime, "Pickup time")
      : requireDate(data.dropTime, "Drop time");

  const guestBuffer = subMinutes(baseTime, GUEST_BUFFER_MINUTES);
  const pocBuffer = subMinutes(guestBuffer, NORMAL_POC_BUFFER_MINUTES);

  return {
    guestBuffer,
    pocBuffer
  };
}
