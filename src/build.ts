import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { toStation, type NrelStation } from "./transform.ts";
import { snapshot, diffSnapshots, type Snapshot } from "./history.ts";
import { PUBLISHED_TARIFFS } from "./tariffs.ts";
import { applyIonnaPrices, fetchIonnaSites, IONNA_LOCATOR_URL } from "./ionna.ts";
import type { Station } from "./types.ts";

const NREL_URL = "https://developer.nlr.gov/api/alt-fuel-stations/v1.json";
const OUT = process.env.OUT_DIR ?? "public";
const HISTORY = process.env.HISTORY_DIR ?? "data/history";
const HISTORY_DAYS = 120;
export const SCHEMA_VERSION = 1;

async function fetchNrel(apiKey: string): Promise<NrelStation[]> {
  const params = new URLSearchParams({
    api_key: apiKey, fuel_type: "ELEC", ev_charging_level: "dc_fast", status: "E", access: "public", country: "US", limit: "all",
  });
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${NREL_URL}?${params}`, { headers: { "User-Agent": "ev-price-feed (github.com/mjyousse/ev-price-feed)" } });
    if (res.ok) return ((await res.json()) as { fuel_stations: NrelStation[] }).fuel_stations;
    if (attempt === 3 || res.status < 500) throw new Error(`NREL request failed: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 30_000 * attempt));
  }
  return [];
}

function summarize(stations: Station[]) {
  const byNetwork: Record<string, { stations: number; priced: number; nrel: number; published: number; network_site: number; tesla_only: number }> = {};
  for (const s of stations) {
    const n = (byNetwork[s.network] ??= { stations: 0, priced: 0, nrel: 0, published: 0, network_site: 0, tesla_only: 0 });
    n.stations++;
    if (s.price_source !== "none") n.priced++;
    if (s.price_source === "nrel") n.nrel++;
    if (s.price_source === "published") n.published++;
    if (s.price_source === "network_site") n.network_site++;
    if (s.open_to_non_tesla === false) n.tesla_only++;
  }
  return byNetwork;
}

async function loadHistory(): Promise<{ date: string; snap: Snapshot }[]> {
  if (!existsSync(HISTORY)) return [];
  const files = (await readdir(HISTORY)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(-HISTORY_DAYS);
  return Promise.all(files.map(async (f) => ({ date: f.slice(0, 10), snap: JSON.parse(await readFile(join(HISTORY, f), "utf8")) })));
}

async function main() {
  const key = process.env.NREL_API_KEY || "DEMO_KEY";
  if (key === "DEMO_KEY") console.warn("NREL_API_KEY not set; using DEMO_KEY (heavily rate limited).");
  const fetchedAt = new Date().toISOString();
  const today = fetchedAt.slice(0, 10);
  const raw = await fetchNrel(key);
  const stations = raw.filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude)).map((s) => toStation(s, fetchedAt));
  const ionnaSites = await fetchIonnaSites();
  const ionnaMatched = applyIonnaPrices(stations, ionnaSites, today);
  console.log(`IONNA locator: ${ionnaSites.length} sites, ${ionnaMatched} NREL stations matched`);
  stations.sort((a, b) => a.state.localeCompare(b.state) || a.nrel_id - b.nrel_id);

  await mkdir(join(OUT, "states"), { recursive: true });
  await mkdir(join(OUT, "history"), { recursive: true });
  await mkdir(HISTORY, { recursive: true });

  const meta = {
    schema_version: SCHEMA_VERSION,
    generated_at: fetchedAt,
    station_count: stations.length,
    priced_count: stations.filter((s) => s.price_source !== "none").length,
    networks: summarize(stations),
    sources: {
      stations: "NREL Alternative Fuels Data Center (developer.nlr.gov), public DC fast stations",
      network_sites: [IONNA_LOCATOR_URL],
      published_tariffs: [...new Set(PUBLISHED_TARIFFS.map((t) => t.source_url))],
    },
  };

  await writeFile(join(OUT, "prices.json"), JSON.stringify({ ...meta, stations }));
  const states = [...new Set(stations.map((s) => s.state))];
  for (const st of states) {
    await writeFile(join(OUT, "states", `${st}.json`), JSON.stringify({ schema_version: SCHEMA_VERSION, generated_at: fetchedAt, state: st, stations: stations.filter((s) => s.state === st) }));
  }
  await writeFile(join(OUT, "meta.json"), JSON.stringify({ ...meta, states: states.sort() }, null, 2));

  const snap = snapshot(stations);
  await writeFile(join(HISTORY, `${today}.json`), JSON.stringify(snap));
  const days = await loadHistory();
  const changes = diffSnapshots(days);
  for (const d of days) await writeFile(join(OUT, "history", `${d.date}.json`), JSON.stringify(d.snap));
  await writeFile(join(OUT, "history", "index.json"), JSON.stringify({ dates: days.map((d) => d.date), changes }));
  await writeFile(join(OUT, "index.html"), `<!doctype html><meta charset="utf-8"><title>EV Price Feed</title><h1>EV Price Feed</h1><p>Generated ${fetchedAt}. ${meta.station_count} stations, ${meta.priced_count} with prices.</p><ul><li><a href="prices.json">prices.json</a></li><li><a href="meta.json">meta.json</a></li><li><a href="history/index.json">history/index.json</a></li></ul>`);

  console.log(JSON.stringify({ stations: meta.station_count, priced: meta.priced_count, history_days: days.length, changes: changes.length }));
  for (const [n, v] of Object.entries(meta.networks).sort((a, b) => b[1].stations - a[1].stations).slice(0, 25)) console.log(n.padEnd(28), JSON.stringify(v));
}

main().catch((e) => { console.error(e); process.exit(1); });
