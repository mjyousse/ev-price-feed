import { distanceMeters } from "./geo.ts";
import { sameNetwork, networkName } from "./networks.ts";
import type { DcfcCache, Headline } from "./dcfctracker.ts";
import type { Station } from "./types.ts";

/** Station set from the previous run, plus stations that dropped off DCFC Tracker. */
export interface Registry {
  date: string | null;
  ids: number[];
  removed: Record<string, { removed_on: string; name: string; network: string; state: string }>;
}

export interface MirrorResult {
  stations: Station[];
  registry: Registry;
  added: number[];
  removed: number[];
  /** Stations taken from DCFC Tracker pages because NREL does not list them */
  beyond_nrel: number;
  /** Listed on DCFC Tracker but skipped: not in NREL and no station page yet */
  missing_place: number;
  guard_tripped: boolean;
}

const DCFC_NETWORKS: Record<string, string> = { "BP Pulse": "bp pulse", "Rivian": "Rivian Adventure Network", "Mercedes-Benz": "Mercedes-Benz HPC", "Non-Networked": "Non-networked" };
const net = (n: string | null | undefined) => (n ? DCFC_NETWORKS[n] ?? networkName(n) : "Unknown");

function fromPage(id: number, h: Headline | undefined, cache: DcfcCache, fetchedAt: string): Station | null {
  const d = cache.details[id];
  const p = d?.place;
  if (!d || !p || d.lat == null || d.lon == null) return null;
  const network = net(h?.network ?? d.network);
  const connectors = p.connectors.map((c) => (c === "J3400" ? "NACS (J3400)" : c));
  return {
    network, network_raw: h?.network ?? d.network ?? "", station_ref: `dcfc:${id}`, nrel_id: id,
    name: p.name, address: p.address, city: p.city, state: p.state || h?.state || "", zip: p.zip,
    lat: d.lat, lon: d.lon, dc_ports: p.stalls, connectors, max_kw: p.max_kw,
    open_to_non_tesla: network === "Tesla" ? (connectors.includes("CCS") ? true : null) : true,
    hours: null, facility_type: null, open_date: p.open_date, last_confirmed: null, pricing_text: null,
    fetched_at: fetchedAt, checked_at: fetchedAt, price_updated: null, price_changed_at: null,
    price_per_kwh: null, member_price: null, off_peak_price: null, per_minute: null, session_fee: null, idle_fee: null,
    time_of_day: [], free: false, currency: "USD", price_source: "none", price_note: null,
    source_url: `https://dcfctracker.com/stations/${id}`, verified_on: null,
  };
}

/**
 * Output set = stations listed on DCFC Tracker. NREL records enrich them (matched by id, else within
 * 150 m on the same network); the rest are built from DCFC Tracker's station pages. If the fetch failed
 * or came back under 80% of the previous count, nothing is removed this run.
 */
export function buildMirror(nrel: Station[], headlines: Map<number, Headline>, cache: DcfcCache, prev: Registry, today: string, fetchedAt: string, minRatio = 0.8): MirrorResult {
  const prevIds = new Set(prev.ids);
  const guard = headlines.size === 0 || (prev.ids.length > 0 && headlines.size < prev.ids.length * minRatio);
  const ids = new Set<number>(headlines.keys());
  if (guard) for (const id of prevIds) ids.add(id);

  const byId = new Map(nrel.map((s) => [s.nrel_id, s]));
  const used = new Set<Station>();
  const out: Station[] = [];
  let beyond = 0, missing = 0;
  for (const id of [...ids].sort((a, b) => a - b)) {
    let s = byId.get(id);
    if (!s) {
      const d = cache.details[id];
      if (d?.lat != null && d.lon != null) {
        let bestD = Infinity;
        const n = net(headlines.get(id)?.network ?? d.network);
        for (const c of nrel) {
          if (used.has(c) || byId.get(c.nrel_id) !== c || ids.has(c.nrel_id) || !sameNetwork(n, c.network)) continue;
          const dist = distanceMeters(d.lat, d.lon, c.lat, c.lon);
          if (dist <= 150 && dist < bestD) { s = c; bestD = dist; }
        }
      }
    }
    if (s && used.has(s)) continue;
    if (!s) {
      const p = fromPage(id, headlines.get(id), cache, fetchedAt);
      if (!p) { missing++; continue; }
      s = p;
      beyond++;
    }
    used.add(s);
    out.push(s);
  }

  const added = guard ? [] : [...ids].filter((id) => prev.ids.length > 0 && !prevIds.has(id));
  const removed = guard ? [] : prev.ids.filter((id) => !ids.has(id));
  const removedMap = { ...prev.removed };
  const prevById = new Map(nrel.map((s) => [s.nrel_id, s]));
  for (const id of removed) {
    const s = prevById.get(id);
    removedMap[id] = { removed_on: today, name: s?.name ?? cache.details[id]?.place?.name ?? "", network: s?.network ?? net(cache.details[id]?.network), state: s?.state ?? cache.details[id]?.place?.state ?? "" };
  }
  for (const id of ids) delete removedMap[id];
  return {
    stations: out, added, removed, beyond_nrel: beyond, missing_place: missing, guard_tripped: guard,
    registry: { date: today, ids: [...ids].sort((a, b) => a - b), removed: removedMap },
  };
}
