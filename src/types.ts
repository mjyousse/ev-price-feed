export interface TimeOfDayRate {
  /** Local start time, "HH:MM" */
  start: string;
  /** Local end time, "HH:MM" (may wrap past midnight) */
  end: string;
  price_per_kwh: number;
  label?: string;
}

export interface Pricing {
  price_per_kwh: number | null;
  member_price: number | null;
  /** Off-peak $/kWh when a peak/off-peak pair is published without exact hours */
  off_peak_price: number | null;
  per_minute: number | null;
  session_fee: number | null;
  idle_fee: number | null;
  time_of_day: TimeOfDayRate[];
  free: boolean;
  currency: "USD";
  /** "nrel" = station-level text from NREL; "published" = network's own published tariff; "none" */
  price_source: "nrel" | "published" | "none";
  price_note: string | null;
  source_url: string | null;
  verified_on: string | null;
}

export interface Station extends Pricing {
  network: string;
  network_raw: string;
  station_ref: string;
  nrel_id: number;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lon: number;
  dc_ports: number;
  connectors: string[];
  max_kw: number | null;
  /** false = Tesla-only site, true = usable by other EVs, null = unknown */
  open_to_non_tesla: boolean | null;
  hours: string | null;
  facility_type: string | null;
  open_date: string | null;
  last_confirmed: string | null;
  pricing_text: string | null;
  fetched_at: string;
}
