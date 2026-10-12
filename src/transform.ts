import type { Station } from "./types.ts";
import { networkName } from "./networks.ts";
import { parsePricing } from "./parsePricing.ts";
import { findTariff, PUBLISHED_TARIFFS, type PublishedTariff } from "./tariffs.ts";

export interface NrelStation {
  id: number;
  station_name: string;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  latitude: number;
  longitude: number;
  ev_network: string | null;
  ev_network_web?: string | null;
  ev_dc_fast_num: number | null;
  ev_connector_types: string[] | null;
  ev_pricing: string | null;
  access_days_time: string | null;
  facility_type: string | null;
  open_date: string | null;
  date_last_confirmed: string | null;
  ev_charging_units?: { charging_level?: string; connectors?: Record<string, { power_kw: number | null; port_count: number }> }[] | null;
}

const CONNECTOR_NAMES: Record<string, string> = { J1772COMBO: "CCS", TESLA: "NACS", CHADEMO: "CHAdeMO", J3271: "NACS (J3400)" };

function maxKw(s: NrelStation): number | null {
  let best: number | null = null;
  for (const u of s.ev_charging_units ?? []) {
    if (u.charging_level && u.charging_level.toLowerCase() !== "dc_fast" && u.charging_level !== "3") continue;
    for (const c of Object.values(u.connectors ?? {})) {
      if (c.port_count > 0 && c.power_kw && (best === null || c.power_kw > best)) best = c.power_kw;
    }
  }
  return best;
}

/** Tesla sites: NREL marks Tesla-only sites in the access text. CCS (Magic Dock) or explicit text means open. */
export function openToNonTesla(s: NrelStation): boolean | null {
  const access = (s.access_days_time ?? "").toLowerCase();
  const conns = s.ev_connector_types ?? [];
  if ((s.ev_network ?? "") !== "Tesla") return conns.length > 0 && !(conns.length === 1 && conns[0] === "TESLA") ? true : null;
  if (/teslas only|tesla vehicles only|tesla only/.test(access)) return false;
  if (conns.includes("J1772COMBO") || /all evs|non-tesla|other evs|nacs-compatible|open to all/.test(access)) return true;
  return null;
}

export function toStation(s: NrelStation, fetchedAt: string, tariffs: PublishedTariff[] = PUBLISHED_TARIFFS): Station {
  const network = networkName(s.ev_network);
  const p = parsePricing(s.ev_pricing);
  const base = {
    network,
    network_raw: s.ev_network ?? "",
    station_ref: `nrel:${s.id}`,
    nrel_id: s.id,
    name: s.station_name,
    address: s.street_address ?? "",
    city: s.city ?? "",
    state: s.state ?? "",
    zip: s.zip ?? "",
    lat: s.latitude,
    lon: s.longitude,
    dc_ports: s.ev_dc_fast_num ?? 0,
    connectors: (s.ev_connector_types ?? []).filter((c) => CONNECTOR_NAMES[c]).map((c) => CONNECTOR_NAMES[c]),
    max_kw: maxKw(s),
    open_to_non_tesla: openToNonTesla(s),
    hours: s.access_days_time,
    facility_type: s.facility_type,
    open_date: s.open_date,
    last_confirmed: s.date_last_confirmed,
    pricing_text: s.ev_pricing,
    fetched_at: fetchedAt,
    currency: "USD" as const,
    member_price: null,
  };
  const nrelUrl = `https://afdc.energy.gov/stations/#/station/${s.id}`;
  if (p.parsed) {
    return {
      ...base,
      price_per_kwh: p.price_per_kwh, off_peak_price: p.off_peak, per_minute: p.per_minute,
      session_fee: p.session_fee, idle_fee: p.idle_fee, time_of_day: p.time_of_day, free: p.free,
      price_source: "nrel",
      price_note: network === "Tesla" ? "Price as reported to NREL; Tesla's member/non-member split is not published." : null,
      source_url: nrelUrl, verified_on: s.date_last_confirmed,
    };
  }
  const t = findTariff({ network, city: base.city, state: base.state }, tariffs);
  if (t) {
    return {
      ...base,
      price_per_kwh: t.price_per_kwh, off_peak_price: null, per_minute: null, session_fee: null, idle_fee: null,
      time_of_day: t.time_of_day ?? [], free: false, price_source: "published",
      price_note: t.is_ceiling ? `${t.note} (ceiling)` : t.note, source_url: t.source_url, verified_on: t.verified_on,
    };
  }
  return {
    ...base,
    price_per_kwh: null, off_peak_price: null, per_minute: null, session_fee: null, idle_fee: null,
    time_of_day: [], free: false, price_source: "none",
    price_note: s.ev_pricing ? `Unparsed: ${s.ev_pricing}` : null, source_url: nrelUrl, verified_on: null,
  };
}
