import { requiredEnv } from "@/lib/env";
import type { SolveRequest, SolveResponse } from "@/types/scheduling";

export async function callSolver(request: SolveRequest): Promise<SolveResponse> {
  const baseUrl = requiredEnv("SCHEDULER_SERVICE_URL");
  const secret = requiredEnv("SCHEDULER_SERVICE_SECRET");

  const response = await fetch(`${baseUrl}/solve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`
    },
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Scheduler service returned ${response.status}: ${text}`);
  }

  return (await response.json()) as SolveResponse;
}
