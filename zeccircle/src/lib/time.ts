export const nowIso = (): string => new Date().toISOString();

/** Start of the current calendar month in UTC, as an ISO string. Spend caps reset at this boundary. */
export function startOfMonthUtcIso(date: Date = new Date()): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
