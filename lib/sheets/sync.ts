import { google, sheets_v4 } from "googleapis";
import { createAdminClient } from "@/lib/supabase/admin";
import { requiredEnv } from "@/lib/env";
import { SHEET_HEADERS, sortTripsByTime, tripToSheetRow } from "@/lib/sheets/columns";
import { allEventDayLabels, getDayLabel, getDayLabelSortIndex } from "@/lib/calculations/eventDays";
import type { QueueStatus, Trip } from "@/types/trip";

type SyncQueueItem = {
  id: string;
  trip_id: string;
  attempts: number;
};

const FULL_COLUMN_RANGE_SUFFIX = `A:${columnLetter(SHEET_HEADERS.length)}`;

function columnLetter(oneIndexedColumnCount: number): string {
  let n = oneIndexedColumnCount;
  let letters = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

// Reuse the JWT auth client across calls within the same sync run
// instead of constructing a new one for every helper function.
let _sheetsClient: sheets_v4.Sheets | null = null;
async function getSheetsClient(): Promise<sheets_v4.Sheets> {
  if (_sheetsClient) return _sheetsClient;
  const auth = new google.auth.JWT({
    email: requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    key: requiredEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  _sheetsClient = google.sheets({ version: "v4", auth });
  return _sheetsClient;
}

async function getDayZeroDate(): Promise<string> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("event_config")
    .select("day_zero_date")
    .eq("id", 1)
    .maybeSingle();

  if (error) throw new Error(`Could not read event_config: ${error.message}`);
  if (!data?.day_zero_date) {
    throw new Error(
      "Day 0 hasn't been set yet. An admin needs to set the event's Day 0 date before trips can sync to the sheet."
    );
  }
  return data.day_zero_date;
}

async function fetchAllTrips(): Promise<Trip[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("trips")
    .select(
      "id, team_id, guest_name, guest_designation, travel_date, direction, location_type, pickup_location, drop_location, flight_time, pickup_time, drop_time, poc_name, poc_contact, guest_buffer_time, poc_buffer_time, corrected_drop_time, sync_status, gsheet_row_id, created_at, updated_at, teams(id, name)"
    );

  if (error) throw new Error(error.message);
  return (data || []) as unknown as Trip[];
}

async function fetchPendingQueueItems(limit: number): Promise<SyncQueueItem[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("sync_queue")
    .select("id, trip_id, attempts")
    .eq("status", "PENDING")
    .lte("run_after", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data || []) as SyncQueueItem[];
}

async function markQueueItems(ids: string[], status: QueueStatus, errorMessage?: string) {
  if (ids.length === 0) return;
  const supabase = createAdminClient();
  await supabase
    .from("sync_queue")
    .update({
      status,
      error_message: errorMessage || null,
      processed_at: status === "SYNCED" ? new Date().toISOString() : null
    })
    .in("id", ids);
}

// Fixed: was N serial awaits per item; now two bulk updates regardless of
// how many items failed.
async function bumpQueueAttempts(items: SyncQueueItem[], errorMessage: string) {
  if (items.length === 0) return;
  const supabase = createAdminClient();

  const retryIds: string[] = [];
  const failedIds: string[] = [];
  const retryTripIds: string[] = [];
  const failedTripIds: string[] = [];

  for (const item of items) {
    const nextAttempts = item.attempts + 1;
    if (nextAttempts >= 5) {
      failedIds.push(item.id);
      failedTripIds.push(item.trip_id);
    } else {
      retryIds.push(item.id);
      retryTripIds.push(item.trip_id);
    }
  }

  const runAfter = new Date(Date.now() + 5 * 60_000).toISOString(); // 5 min retry

  // All updates in parallel
  await Promise.all([
    retryIds.length > 0
      ? supabase
          .from("sync_queue")
          .update({ attempts: items[0].attempts + 1, status: "PENDING", error_message: errorMessage, run_after: runAfter })
          .in("id", retryIds)
      : Promise.resolve(),
    failedIds.length > 0
      ? supabase
          .from("sync_queue")
          .update({ attempts: 5, status: "FAILED", error_message: errorMessage })
          .in("id", failedIds)
      : Promise.resolve(),
    retryTripIds.length > 0
      ? supabase.from("trips").update({ sync_status: "PENDING" }).in("id", retryTripIds)
      : Promise.resolve(),
    failedTripIds.length > 0
      ? supabase.from("trips").update({ sync_status: "FAILED" }).in("id", failedTripIds)
      : Promise.resolve()
  ]);
}

// Fixed: previously called spreadsheets.get twice (once in ensureTabsExist,
// once in applyHeaderFormatting). Now we fetch metadata once and pass it.
async function getSpreadsheetMeta(sheets: sheets_v4.Sheets, spreadsheetId: string) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  return meta.data.sheets || [];
}

async function ensureTabsExist(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  labels: string[],
  existingSheets: sheets_v4.Schema$Sheet[]
) {
  const existingTitles = new Set(existingSheets.map((s) => s.properties?.title).filter(Boolean));
  const missing = labels.filter((label) => !existingTitles.has(label));
  if (missing.length === 0) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: missing.map((title) => ({ addSheet: { properties: { title } } }))
    }
  });
}

async function writeDayTab(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  label: string,
  rows: string[][]
) {
  const range = `${label}!${FULL_COLUMN_RANGE_SUFFIX}`;
  await sheets.spreadsheets.values.clear({ spreadsheetId, range });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${label}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [SHEET_HEADERS, ...rows] }
  });
}

async function applyHeaderFormatting(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  labels: string[],
  existingSheets: sheets_v4.Schema$Sheet[]
) {
  // Re-fetch if new tabs were just added (they won't be in existingSheets)
  const freshMeta = await sheets.spreadsheets.get({ spreadsheetId });
  const allSheets = freshMeta.data.sheets || [];

  const sheetIdByTitle = new Map(
    allSheets.map((s) => [s.properties?.title, s.properties?.sheetId])
  );

  const requests = labels.flatMap((label) => {
    const sheetId = sheetIdByTitle.get(label);
    if (sheetId === undefined || sheetId === null) return [];
    return [
      {
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
          fields: "gridProperties.frozenRowCount"
        }
      },
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
          cell: {
            userEnteredFormat: {
              textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
              backgroundColor: { red: 0.13, green: 0.13, blue: 0.18 },
              horizontalAlignment: "CENTER"
            }
          },
          fields: "userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)"
        }
      },
      // Alternate row banding for readability
      {
        addBanding: {
          bandedRange: {
            range: { sheetId, startRowIndex: 1, startColumnIndex: 0 },
            rowProperties: {
              headerColor: { red: 0.13, green: 0.13, blue: 0.18 },
              firstBandColor: { red: 1, green: 1, blue: 1 },
              secondBandColor: { red: 0.95, green: 0.96, blue: 0.98 }
            }
          }
        }
      }
    ];
  });

  if (requests.length === 0) return;

  // addBanding fails if banding already exists — ignore that error
  try {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  } catch {
    // Apply just the freeze + header colour without the banding on retry
    const safeRequests = requests.filter((r) => !("addBanding" in r));
    if (safeRequests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: safeRequests }
      });
    }
  }
}

export async function processPendingSyncs(limit = 50) {
  // Check Day 0 before touching the queue. Missing Day 0 is a global
  // configuration issue unrelated to individual trips; if we let this
  // error fall into the catch below it would burn every queued item's
  // attempt counter and eventually FAIL them all permanently, even though
  // the trips themselves are perfectly valid. Return quietly so the queue
  // stays untouched and will drain normally once an admin sets the date.
  let dayZeroDate: string;
  try {
    dayZeroDate = await getDayZeroDate();
  } catch {
    return { processed: 0, results: [] };
  }

  const queueItems = await fetchPendingQueueItems(limit);
  if (queueItems.length === 0) return { processed: 0, results: [] };

  const spreadsheetId = requiredEnv("GOOGLE_SHEETS_SPREADSHEET_ID");
  const sheets = await getSheetsClient();

  try {
    // Fetch trips and sheet metadata in parallel (dayZeroDate already resolved above)
    const [trips, existingSheets] = await Promise.all([
      fetchAllTrips(),
      getSpreadsheetMeta(sheets, spreadsheetId)
    ]);

    const groups = new Map<string, Trip[]>();
    for (const trip of trips) {
      const label = getDayLabel(trip.travel_date, dayZeroDate);
      const bucket = groups.get(label) || [];
      bucket.push(trip);
      groups.set(label, bucket);
    }

    const labels = Array.from(new Set([...allEventDayLabels(), ...groups.keys()])).sort(
      (a, b) => getDayLabelSortIndex(a) - getDayLabelSortIndex(b)
    );

    await ensureTabsExist(sheets, spreadsheetId, labels, existingSheets);

    // Write all day tabs in parallel
    await Promise.all(
      labels.map((label) => {
        const tripsForDay = sortTripsByTime(groups.get(label) || []);
        const rows = tripsForDay.map(tripToSheetRow);
        return writeDayTab(sheets, spreadsheetId, label, rows);
      })
    );

    await applyHeaderFormatting(sheets, spreadsheetId, labels, existingSheets);

    const supabase = createAdminClient();
    const tripIds = trips.map((trip) => trip.id);

    // Mark trips synced and drain queue in parallel
    await Promise.all([
      supabase.from("trips").update({ sync_status: "SYNCED" }).in("id", tripIds),
      markQueueItems(queueItems.map((item) => item.id), "SYNCED")
    ]);

    return {
      processed: queueItems.length,
      results: queueItems.map((item) => ({ id: item.id, tripId: item.trip_id, status: "SYNCED" as const }))
    };
  } catch (syncError) {
    const message = syncError instanceof Error ? syncError.message : "Unknown sync error";
    await bumpQueueAttempts(queueItems, message);
    return {
      processed: queueItems.length,
      results: queueItems.map((item) => ({
        id: item.id,
        tripId: item.trip_id,
        status: "FAILED" as const,
        error: message
      }))
    };
  }
}