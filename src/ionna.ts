import { distanceMeters } from "./geo.ts";
import type { Station } from "./types.ts";

export const IONNA_LOCATOR_URL = "https://www.ionna.com/rechargeries/find-a-rechargery/";
const ROBOTS_URL = "https://www.ionna.com/robots.txt";
const USER_AGENT = "ev-price-feed/0.1 (+https://github.com/mjyousse/ev-price-feed; once daily)";

export interface IonnaSite {
  site_id: string | null;
  title: string;
  status: string | null;
  price_per_kwh: number | null;
  price_text: string | null;
  price_updated: string | null;
  speed_kw: number | null;
  lat: number;
  lon: number;
  link: string | null;
}

const clean = (html: unknown): string | null => {
  if (typeof html !== "string") return null;
  const t = html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").replace(/\s+\//g, "/").trim();
  return t || null;
};

/** Pulls the `window.allLocations = {...}` object out of the locator page. */
export function extractLocations(html: string): Record<string, Record<string, unknown>> {
  const marker = html.indexOf("window.allLocations");
  if (marker < 0) throw new Error("IONNA locator: allLocations not found");
  const start = html.indexOf("{", marker);
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(html.slice(start, i + 1));
  }
  throw new Error("IONNA locator: unterminated allLocations");
}

export function parseIonnaPage(html: string): IonnaSite[] {
  const out: IonnaSite[] = [];
  for (const loc of Object.values(extractLocations(html))) {
    const num = (v: unknown) => (v === null || v === undefined || String(v).trim() === "" ? NaN : Number(v));
    const lat = num(loc.lat), lon = num(loc.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const priceText = clean(loc.price);
    const m = priceText?.match(/\$\s*(\d+(?:\.\d+)?)\s*\/?\s*kWh/i);
    const speed = Number(loc.speed);
    out.push({
      site_id: typeof loc.site_id === "string" ? loc.site_id : null,
      title: String(loc.title ?? ""),
      status: typeof loc.status === "string" ? loc.status : null,
      price_per_kwh: m ? Number(m[1]) : null,
      price_text: priceText,
      price_updated: clean(loc.price_updated)?.replace(/^\(|\)$/g, "") ?? null,
      speed_kw: Number.isFinite(speed) && speed > 0 ? speed : null,
      lat, lon,
      link: typeof loc.link === "string" ? loc.link : null,
    });
  }
  return out;
}

async function crawlDelaySeconds(): Promise<number> {
  try {
    const res = await fetch(ROBOTS_URL, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return 10;
    const vals = [...(await res.text()).matchAll(/^crawl-delay:\s*(\d+(?:\.\d+)?)/gim)].map((m) => Number(m[1]));
    return vals.length ? Math.max(...vals) : 0;
  } catch {
    return 10;
  }
}

/** One locator request per run, after honouring robots.txt crawl-delay. Returns [] on failure so the build falls back. */
export async function fetchIonnaSites(): Promise<IonnaSite[]> {
  try {
    const delay = await crawlDelaySeconds();
    await new Promise((r) => setTimeout(r, delay * 1000));
    const res = await fetch(IONNA_LOCATOR_URL, { headers: { "User-Agent": USER_AGENT, Accept: "text/html" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseIonnaPage(await res.text());
  } catch (e) {
    console.warn(`IONNA locator unavailable, keeping published maximum: ${(e as Error).message}`);
    return [];
  }
}

/** Replaces the network-wide ceiling with the site's own posted price for IONNA stations within maxMeters. */
export function applyIonnaPrices(stations: Station[], sites: IonnaSite[], verifiedOn: string, maxMeters = 150): number {
  const priced = sites.filter((s) => s.price_per_kwh !== null);
  let matched = 0;
  for (const st of stations) {
    if (st.network !== "IONNA") continue;
    let best: IonnaSite | null = null, bestD = Infinity;
    for (const site of priced) {
      const d = distanceMeters(st.lat, st.lon, site.lat, site.lon);
      if (d <= maxMeters && d < bestD) { best = site; bestD = d; }
    }
    if (!best) continue;
    matched++;
    st.price_per_kwh = best.price_per_kwh;
    st.off_peak_price = null;
    st.per_minute = null;
    st.time_of_day = [];
    st.free = false;
    st.price_source = "network_site";
    st.price_note = [best.price_text, best.price_updated ? `(${best.price_updated})` : null, "Posted on IONNA's station locator; rates can change by time of day."].filter(Boolean).join(" ");
    st.source_url = best.link ?? IONNA_LOCATOR_URL;
    st.verified_on = verifiedOn;
  }
  return matched;
}
