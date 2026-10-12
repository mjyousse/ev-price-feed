import type { Station } from "./types.ts";

/** Compact daily snapshot: station_ref -> [price_per_kwh, per_minute, off_peak_price, note?]. The note keeps posted price text (time of use, "last updated") for network_site prices. */
export type Snapshot = Record<string, [number | null, number | null, number | null] | [number | null, number | null, number | null, string]>;

export function snapshot(stations: Station[]): Snapshot {
  const out: Snapshot = {};
  for (const s of stations) {
    if (s.price_source === "none") continue;
    out[s.station_ref] = s.price_source === "network_site" && s.price_note
      ? [s.price_per_kwh, s.per_minute, s.off_peak_price, s.price_note]
      : [s.price_per_kwh, s.per_minute, s.off_peak_price];
  }
  return out;
}

export interface PriceChange { station_ref: string; date: string; from: number | null; to: number | null }

/** Changes in price_per_kwh between consecutive dated snapshots (dates ascending). */
export function diffSnapshots(days: { date: string; snap: Snapshot }[]): PriceChange[] {
  const changes: PriceChange[] = [];
  for (let i = 1; i < days.length; i++) {
    const prev = days[i - 1].snap, cur = days[i].snap;
    for (const [ref, v] of Object.entries(cur)) {
      const before = prev[ref];
      if (before && before[0] !== v[0]) changes.push({ station_ref: ref, date: days[i].date, from: before[0], to: v[0] });
    }
  }
  return changes;
}
