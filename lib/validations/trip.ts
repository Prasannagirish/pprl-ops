import { z } from "zod";

const optionalDateTime = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((value) => (value ? value : null));

export const tripInputSchema = z
  .object({
    teamId: z.string().uuid().optional(),
    guestName: z.string().trim().min(2, "Guest name is required."),
    guestDesignation: z.string().trim().optional().default(""),
    travelDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Travel date is required."),
    direction: z.enum(["TO_CAMPUS", "FROM_CAMPUS"]),
    locationType: z.enum(["AIRPORT", "RAILWAY", "BUS_STAND", "OTHER"]),
    pickupLocation: z.string().trim().min(2, "Pickup location is required."),
    dropLocation: z.string().trim().min(2, "Drop location is required."),
    flightTime: optionalDateTime,
    pickupTime: optionalDateTime,
    dropTime: optionalDateTime,
    pocName: z.string().trim().min(2, "POC name is required."),
    pocContact: z.string().trim().min(5, "POC contact is required.")
  })
  .superRefine((data, context) => {
    if (data.locationType === "AIRPORT" && !data.flightTime) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["flightTime"],
        message: "Flight time is required for airport travel."
      });
    }

    if (data.locationType !== "AIRPORT" && data.direction === "TO_CAMPUS" && !data.pickupTime) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pickupTime"],
        message: "Pickup time is required for non-airport arrivals."
      });
    }

    if (data.locationType !== "AIRPORT" && data.direction === "FROM_CAMPUS" && !data.dropTime) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dropTime"],
        message: "Drop time is required for non-airport departures."
      });
    }
  });

export type ValidTripInput = z.infer<typeof tripInputSchema>;

export const teamInputSchema = z.object({
  name: z.string().trim().min(2, "Team name is required.")
});
