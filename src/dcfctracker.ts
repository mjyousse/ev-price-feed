import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { distanceMeters } from "./geo.ts";
import { sameNetwork } from "./networks.ts";
import type { Station, TimeOfDayRate } from "./types.ts";

/**
 * DCFC Tracker (dcfctracker.com) is collected with the site owner's permission, once per daily run.
 * State pages give every site's current headline price; station pages give the full tariff
 * (member/guest, fees, time of day, source date) and are fetched for a capped, rotating subset.
 * Station ids on DCFC Tracker are NREL AFDC ids.
 */
export const DCFC_BASE = "https://dcfctracker.com";
const USER_AGENT = "ev-price-feed/0.1 (+https://github.com/mjyousse/ev-price-feed; once daily, with site owner permission)";
export const STATES = ["al","ak","az","ar","ca","co","ct","de","dc","fl","ga","hi","id","il","in","ia","ks","ky","la","me","md","ma","mi","mn","ms","mo","mt","ne","nv","nh","nj","nm","ny","nc","nd","oh","ok","or","pa","ri","sc","sd","tn","tx","ut","vt","va","wa","wv","wi","wy","pr"];

export interface Headline { network: string | null; price_per_kwh: number | null; per_minute: number | null; free: boolean; text: string | null; state?: string }

export interface DcfcTariff {
  per_kwh: number | null;
  per_minute: number | null;
  session_fee: number | null;
  /** $ per minute */
  idle_fee: number | null;
  time_of_day: TimeOfDayRate[];
  notes: string[];
}

export interface DcfcDetail {
  id: number;
  fetched_on: string;
  network: string | null;
  source: string | null;
  /** YYYY-MM-DD of the network price DCFC Tracker last synced */
  source_date: string | null;
  lat: number | null;
  lon: number | null;
  guest: DcfcTariff;
  member: DcfcTariff | null;
  member_label: string | null;
  /** Site facts from the page's EvChargingStation data, used for stations NREL does not list. */
  place?: DcfcPlace | null;
}

export interface DcfcPlace { name: string; address: string; city: string; state: string; zip: string; open_date: string | null; stalls: number; max_kw: number | null; connectors: string[] }

export function parsePlace(html: string): DcfcPlace | null {
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let j: Record<string, any>;
    try { j = JSON.parse(m[1]); } catch { continue; }
    if (j["@type"] !== "EvChargingStation") continue;
    const a = j.address ?? {};
    let stalls = 0, maxKw: number | null = null;
    const connectors: string[] = [];
    for (const f of j.amenityFeature ?? []) {
      const name = String(f.name ?? ""), v = Number(f.value);
      const c = name.match(/^(.+?) Stalls$/);
      if (c && Number.isFinite(v)) { stalls += v; connectors.push(c[1]); }
      if (/max power/i.test(name) && Number.isFinite(v)) maxKw = v;
    }
    return {
      name: String(j.name ?? ""), address: String(a.streetAddress ?? ""), city: String(a.addressLocality ?? ""),
      state: String(a.addressRegion ?? ""), zip: String(a.postalCode ?? ""), open_date: j.openingDate ?? null,
      stalls, max_kw: maxKw, connectors,
    };
  }
  return null;
}

const text = (s: string) =>
  s.replace(/<!-- -->/g, "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim();

const money = (s: string | null | undefined): number | null => {
  const m = s?.match(/\$\s*(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
};

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
export function parseDate(s: string | null | undefined): string | null {
  const m = s?.match(/\b([A-Z][a-z]{2})[a-z]* (\d{1,2}), (\d{4})\b/);
  if (!m || !MONTHS[m[1].toLowerCase()]) return null;
  return `${m[3]}-${MONTHS[m[1].toLowerCase()]}-${m[2].padStart(2, "0")}`;
}

function headline(t: string): Pick<Headline, "price_per_kwh" | "per_minute" | "free"> {
  if (/^free\b/i.test(t)) return { price_per_kwh: 0, per_minute: null, free: true };
  const kwh = t.match(/\$\s*(\d+(?:\.\d+)?)\s*\/\s*kWh/i);
  const min = t.match(/\$\s*(\d+(?:\.\d+)?)\s*\/\s*min/i);
  return { price_per_kwh: kwh ? Number(kwh[1]) : null, per_minute: min ? Number(min[1]) : null, free: false };
}

/** Station cards on a /states/{st} page: id -> network and headline (guest) price. */
export function parseStatePage(html: string): Map<number, Headline> {
  const out = new Map<number, Headline>();
  for (const m of html.matchAll(/<a [^>]*href="\/stations\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const id = Number(m[1]);
    const body = m[2];
    if (out.has(id) || !body.includes("stalls")) continue;
    const net = body.match(/<span[^>]*background-color:[^"]*"[^>]*>([^<]+)<\/span>/);
    const spans = [...body.matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map((x) => x[1].trim());
    const priceText = spans.find((s) => /^\$\s*\d/.test(s) || /^free$/i.test(s)) ?? null;
    out.set(id, { network: net ? text(net[1]) : null, text: priceText, ...(priceText ? headline(priceText) : { price_per_kwh: null, per_minute: null, free: false }) });
  }
  return out;
}

function clock(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === "PM") h += 12;
  return `${String(h).padStart(2, "0")}:${m[2] ?? "00"}`;
}

function touRows(label: string, price: number): TimeOfDayRate[] {
  const [name, ranges] = label.split(" · ");
  if (!ranges) return [];
  const out: TimeOfDayRate[] = [];
  for (const r of ranges.split(",")) {
    const [a, b] = r.split(/[–-]/);
    const start = a && clock(a), end = b && clock(b);
    if (start && end) out.push({ start, end, price_per_kwh: price, label: name.trim() });
  }
  return out;
}

const emptyTariff = (): DcfcTariff => ({ per_kwh: null, per_minute: null, session_fee: null, idle_fee: null, time_of_day: [], notes: [] });

function applyRow(t: DcfcTariff, label: string, value: string) {
  const l = label.toLowerCase();
  const v = money(value);
  const idle = (s: string) => {
    const m = s.match(/\$\s*(\d+(?:\.\d+)?)\s*\/\s*(min|hr|hour)\b[^$]*?idle|idle fee[^$]*\$\s*(\d+(?:\.\d+)?)\s*\/\s*(min|hr|hour)/i)
      ?? s.match(/\$\s*(\d+(?:\.\d+)?)\s*\/\s*(min|hr|hour)/i);
    if (!m) return null;
    const amt = Number(m[1] ?? m[3]), unit = (m[2] ?? m[4]).toLowerCase();
    return unit === "min" ? amt : +(amt / 60).toFixed(4);
  };
  if (l.includes("idle")) { t.idle_fee = idle(value); t.notes.push(`Idle fee ${value}`); return; }
  if (l.includes("session") || l.includes("connection")) { t.session_fee = v; return; }
  if (l.includes("per min") || /\/\s*min/.test(value) && !l.includes("note")) { t.per_minute = v; return; }
  if (l.includes(" · ") && /kwh/i.test(value) && v !== null) { t.time_of_day.push(...touRows(label, v)); return; }
  if ((l.includes("kwh") || l.includes("peak price")) && v !== null) { t.per_kwh = v; return; }
  if (l === "note") {
    if (/idle/i.test(value)) t.idle_fee = idle(value);
    t.notes.push(value);
    return;
  }
  if (v !== null && /kwh/i.test(value) && t.per_kwh === null) t.per_kwh = v;
}

const MEMBER = /member|subscription|plan|pass|rivian$|plus|premium/i;

/** Pricing block of a /stations/{id} page. */
export function parseStationPage(html: string, id: number, fetchedOn: string): DcfcDetail {
  const start = html.indexOf("Price now");
  const end = html.indexOf(">History<", start);
  const seg = start >= 0 ? html.slice(start, end > 0 ? end : undefined) : "";
  const groups: { label: string | null; t: DcfcTariff }[] = [{ label: null, t: emptyTariff() }];
  let source = null as string | null;
  const marks = [...seg.matchAll(/<div class="([^"]*)"[^>]*>/g)].filter((m) => m[1].includes("justify-between") || (m[1].includes("rounded-t-xl") && m[1].includes("bg-muted")));
  marks.forEach((m, i) => {
    const cls = m[1];
    const inner = seg.slice(m.index! + m[0].length, i + 1 < marks.length ? marks[i + 1].index : seg.length);
    if (cls.includes("rounded-t-xl")) { groups.push({ label: text(inner), t: emptyTariff() }); return; }
    const all = text(inner);
    if (/^Source\b/.test(all)) {
      const s = all.replace(/^Source:?\s*/, "");
      source = s.match(/^.*?\b[A-Z][a-z]{2} \d{1,2}, \d{4}/)?.[0] ?? s.split("<")[0].trim();
      return;
    }
    const first = inner.match(/<span[^>]*>([\s\S]*?)<\/span>/);
    const label = first ? text(first[1]) : "";
    if (!label || !all.startsWith(label)) return;
    const value = all.slice(label.length).trim();
    if (value) applyRow(groups[groups.length - 1].t, label, value);
  });
  const named = groups.slice(1);
  let guest = groups[0].t, member: DcfcTariff | null = null, memberLabel: string | null = null;
  if (named.length) {
    const g = named.find((x) => !MEMBER.test(x.label ?? "")) ?? named[named.length - 1];
    const mem = named.find((x) => x !== g && MEMBER.test(x.label ?? ""));
    guest = g.t;
    if (mem) { member = mem.t; memberLabel = mem.label; }
  }
  if (guest.per_kwh === null && guest.time_of_day.length) guest.per_kwh = Math.max(...guest.time_of_day.map((r) => r.price_per_kwh));
  const ll = html.match(/"latitude":\s*(-?\d+(?:\.\d+)?),\s*"longitude":\s*(-?\d+(?:\.\d+)?)/);
  const sub = html.slice(start, start + 4000).match(/text-muted-fo[^"]*">([^<]+(?:<!-- -->[^<]*)*)<\/div>/);
  const network = source?.split(/ · | \d|\s+[A-Z][a-z]{2} \d/)[0]?.trim() || (sub ? text(sub[1]).split(" · ")[0] : null);
  return {
    id, fetched_on: fetchedOn, network: network || null, source, source_date: parseDate(source),
    lat: ll ? Number(ll[1]) : null, lon: ll ? Number(ll[2]) : null,
    guest, member, member_label: memberLabel, place: parsePlace(html),
  };
}

export interface DcfcCache { details: Record<string, DcfcDetail> }

export async function loadCache(path: string): Promise<DcfcCache> {
  if (!existsSync(path)) return { details: {} };
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return { details: {} }; }
}

export async function saveCache(path: string, cache: DcfcCache) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(cache));
}

/** Which station pages to refresh today: headline changed or never fetched first, then the oldest. */
/**
 * Which station pages to refresh today. Stations NREL does not list and that have no cached page come
 * first (their page is the only source of coordinates), then changed headlines, never-fetched, oldest.
 */
export function pickDetailIds(headlines: Map<number, Headline>, cache: DcfcCache, limit: number, knownIds: Set<number> = new Set()): number[] {
  const fresh: number[] = [], changed: number[] = [], missing: number[] = [], rest: [number, string][] = [];
  for (const [id, h] of headlines) {
    if (!knownIds.has(id) && knownIds.size && !cache.details[id]?.place) { fresh.push(id); continue; }
    const d = cache.details[id];
    if (h.price_per_kwh === null && h.per_minute === null && !h.free) continue;
    if (!d) missing.push(id);
    else if ((d.guest.per_kwh ?? null) !== h.price_per_kwh && h.price_per_kwh !== null) changed.push(id);
    else rest.push([id, d.fetched_on]);
  }
  rest.sort((a, b) => a[1].localeCompare(b[1]) || a[0] - b[0]);
  return [...fresh, ...changed, ...missing, ...rest.map((r) => r[0])].slice(0, limit + fresh.length);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string): Promise<string> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html" } });
    if (res.ok) return res.text();
    if (res.status === 404) throw new Error(`HTTP 404 ${url}`);
    const wait = Number(res.headers.get("retry-after")) || 30 * attempt;
    if (attempt === 3) throw new Error(`HTTP ${res.status} ${url}`);
    await sleep(wait * 1000);
  }
  throw new Error("unreachable");
}

export interface DcfcResult { headlines: Map<number, Headline>; cache: DcfcCache; pages: number }

export async function collectDcfc(opts: { cachePath: string; today: string; detailLimit: number; delayMs: number; states?: string[]; knownIds?: Set<number>; maxDetail?: number }): Promise<DcfcResult> {
  const cache = await loadCache(opts.cachePath);
  const headlines = new Map<number, Headline>();
  let pages = 0;
  for (const st of opts.states ?? STATES) {
    try {
      for (const [id, h] of parseStatePage(await get(`${DCFC_BASE}/states/${st}`))) headlines.set(id, { ...h, state: st.toUpperCase() });
    } catch (e) {
      console.warn(`DCFC Tracker state ${st}: ${(e as Error).message}`);
    }
    pages++;
    await sleep(opts.delayMs);
  }
  for (const id of pickDetailIds(headlines, cache, opts.detailLimit, opts.knownIds).slice(0, opts.maxDetail ?? 3000)) {
    try {
      cache.details[id] = parseStationPage(await get(`${DCFC_BASE}/stations/${id}`), id, opts.today);
    } catch (e) {
      console.warn(`DCFC Tracker station ${id}: ${(e as Error).message}`);
    }
    pages++;
    await sleep(opts.delayMs);
  }
  await saveCache(opts.cachePath, cache);
  return { headlines, cache, pages };
}

/**
 * Applies DCFC Tracker prices. Highest priority, except a network's own posted price (network_site)
 * whose date is the same or newer. Tesla stays at the non-member price; member rates go to member_price.
 * open_to_non_tesla is never touched.
 */
export function applyDcfc(stations: Station[], headlines: Map<number, Headline>, cache: DcfcCache, today: string, maxMeters = 150): { matched: number; by_id: number; by_coords: number } {
  const byId = new Map(stations.map((s) => [s.nrel_id, s]));
  let byIdCount = 0, byCoords = 0;
  const done = new Set<Station>();
  const ids = new Set<number>([...headlines.keys(), ...Object.keys(cache.details).map(Number)]);
  for (const id of ids) {
    const h = headlines.get(id) ?? null;
    const d = cache.details[id] ?? null;
    let st = byId.get(id) ?? null;
    let how: "id" | "coords" = "id";
    if (!st && d?.lat != null && d.lon != null) {
      let best: Station | null = null, bestD = Infinity;
      for (const s of stations) {
        if (d.network && !sameNetwork(d.network, s.network)) continue;
        const dist = distanceMeters(d.lat, d.lon, s.lat, s.lon);
        if (dist <= maxMeters && dist < bestD) { best = s; bestD = dist; }
      }
      st = best; how = "coords";
    }
    if (!st || done.has(st)) continue;
    const headKwh = h?.price_per_kwh ?? null;
    const detailFresh = d && (h === null || headKwh === null || d.guest.per_kwh === headKwh);
    const g = detailFresh ? d!.guest : null;
    const kwh = h ? (h.free ? 0 : headKwh) : g?.per_kwh ?? null;
    const perMin = h?.per_minute ?? g?.per_minute ?? null;
    if (kwh === null && perMin === null && !(h?.free)) continue;
    const date = (detailFresh && d!.source_date) || today;
    if (st.price_source === "network_site" && st.verified_on && st.verified_on >= date) continue;
    done.add(st);
    if (how === "id") byIdCount++; else byCoords++;
    st.price_per_kwh = kwh;
    st.per_minute = perMin;
    st.free = !!h?.free;
    st.member_price = detailFresh && d!.member ? d!.member.per_kwh : null;
    st.session_fee = g?.session_fee ?? null;
    st.idle_fee = g?.idle_fee ?? null;
    st.time_of_day = g?.time_of_day ?? [];
    st.off_peak_price = g && g.time_of_day.length ? Math.min(...g.time_of_day.map((r) => r.price_per_kwh)) : null;
    st.price_source = "dcfctracker";
    const parts = [
      detailFresh && d!.source ? `Source: ${d!.source}` : null,
      st.network === "Tesla" ? "Non-member (public) rate." : null,
      detailFresh && d!.member ? `${d!.member_label ?? "Member"}: $${d!.member.per_kwh?.toFixed(2)}/kWh.` : null,
      ...(g?.notes ?? []),
    ].filter(Boolean);
    st.price_note = parts.length ? parts.join(" ") : null;
    st.source_url = `${DCFC_BASE}/stations/${id}`;
    st.verified_on = date;
  }
  return { matched: byIdCount + byCoords, by_id: byIdCount, by_coords: byCoords };
}
