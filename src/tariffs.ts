import type { Station, TimeOfDayRate } from "./types.ts";

/**
 * Prices that networks publish themselves on official pages. These are entered by hand from the
 * cited page (no automated fetching of the network's site) and re-checked when verified_on gets old.
 * They are only applied where NREL has no station-level price. For IONNA the entry below is the
 * fallback for stations not matched to the locator page (see ionna.ts).
 */
export interface PublishedTariff {
  network: string;
  /** Optional city/state filter; omit to apply network-wide. */
  city?: string;
  state?: string;
  price_per_kwh: number | null;
  /** Upper bound only (e.g. "never more than"). */
  is_ceiling?: boolean;
  time_of_day?: TimeOfDayRate[];
  note: string;
  source_url: string;
  verified_on: string;
}

const MB_POWER_HOURS = "https://mercedesbenzhpc.com/power-hours/";
const ph = (city: string, state: string, rate: number, start: string, end: string): PublishedTariff => ({
  network: "Mercedes-Benz HPC", city, state, price_per_kwh: null,
  time_of_day: [{ start, end, price_per_kwh: rate, label: "Power Hours (off-peak)" }],
  note: "Off-peak Power Hours rate published by Mercedes-Benz HPC; daytime rate varies by site (often $0.40-$0.60/kWh).",
  source_url: MB_POWER_HOURS, verified_on: "2026-10-12",
});

export const PUBLISHED_TARIFFS: PublishedTariff[] = [
  {
    network: "IONNA", price_per_kwh: 0.39, is_ceiling: true,
    note: "IONNA publishes a network-wide maximum of $0.39/kWh plus tax, no membership. Some sites run lower promos.",
    source_url: "https://www.ionna.com/blog/public-ev-charging-prices/", verified_on: "2026-10-12",
  },
  ph("Birmingham", "AL", 0.23, "21:00", "08:00"),
  ph("South Windsor", "CT", 0.35, "21:00", "08:00"),
  ph("Tampa", "FL", 0.34, "21:00", "08:00"),
  ph("Alpharetta", "GA", 0.32, "21:00", "08:00"),
  ph("Austell", "GA", 0.22, "21:00", "08:00"),
  ph("Roswell", "GA", 0.22, "21:00", "08:00"),
  ph("Savannah", "GA", 0.32, "21:00", "08:00"),
  ph("Braintree", "MA", 0.29, "20:00", "08:00"),
  ph("Greensboro", "NC", 0.27, "21:00", "08:00"),
  ph("North Charleston", "SC", 0.19, "22:00", "08:00"),
  ph("Denton", "TX", 0.25, "23:00", "08:00"),
  ph("Fort Worth", "TX", 0.27, "22:00", "08:00"),
  ph("Katy", "TX", 0.25, "23:00", "08:00"),
  ph("Round Rock", "TX", 0.23, "21:00", "08:00"),
  ph("Ashburn", "VA", 0.19, "22:00", "08:00"),
  ph("Norfolk", "VA", 0.23, "22:00", "07:00"),
];

export function findTariff(s: Pick<Station, "network" | "city" | "state">, list = PUBLISHED_TARIFFS): PublishedTariff | null {
  const lc = (x?: string) => (x ?? "").trim().toLowerCase();
  const local = list.find((t) => t.network === s.network && t.city && lc(t.city) === lc(s.city) && lc(t.state) === lc(s.state));
  if (local) return local;
  return list.find((t) => t.network === s.network && !t.city) ?? null;
}
