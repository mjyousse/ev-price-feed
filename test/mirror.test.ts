import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseStationPage, parsePlace, pickDetailIds, type DcfcCache, type Headline } from "../src/dcfctracker.ts";
import { buildMirror, type Registry } from "../src/mirror.ts";
import { priceChangedAt, type Snapshot } from "../src/history.ts";
import { centralIso } from "../src/time.ts";
import { toStation, type NrelStation } from "../src/transform.ts";

const tesla = readFileSync(new URL("./fixtures/dcfc-station-tesla.html", import.meta.url), "utf8");
const h = (network: string, p: number | null = 0.5): Headline => ({ network, text: null, price_per_kwh: p, per_minute: null, free: false, state: "TX" });
const nrelBase: NrelStation = {
  id: 1, station_name: "N1", street_address: "1 Main", city: "Austin", state: "TX", zip: "78701", latitude: 30.0, longitude: -97.0,
  ev_network: "eVgo Network", ev_dc_fast_num: 4, ev_connector_types: ["J1772COMBO"], ev_pricing: null, access_days_time: "24 hours daily",
  facility_type: null, open_date: null, date_last_confirmed: null, ev_charging_units: [],
};
const empty: Registry = { date: null, ids: [], removed: {} };

test("station page EvChargingStation facts", () => {
  const p = parsePlace(tesla)!;
  assert.equal(p.name, "Abbott, TX - Tesla Supercharger");
  assert.equal(p.city, "Abbott");
  assert.equal(p.state, "TX");
  assert.equal(p.stalls, 8);
  assert.equal(p.max_kw, 250);
  assert.deepEqual(p.connectors, ["NACS"]);
  assert.equal(p.open_date, "2021-11-24");
});

test("mirror keeps DCFC stations, enriches from NREL, adds the rest from pages, drops NREL-only", () => {
  const n1 = toStation(nrelBase, "t");
  const n2 = toStation({ ...nrelBase, id: 2, latitude: 31 }, "t");
  const cache: DcfcCache = { details: { 201925: parseStationPage(tesla, 201925, "2026-10-12") } };
  const heads = new Map([[1, h("EVgo")], [201925, h("Tesla")], [777, h("EVgo")]]);
  const m = buildMirror([n1, n2], heads, cache, empty, "2026-10-12", "t");
  assert.deepEqual(m.stations.map((s) => s.station_ref), ["nrel:1", "dcfc:201925"]);
  assert.equal(m.beyond_nrel, 1);
  assert.equal(m.missing_place, 1);
  const t = m.stations[1];
  assert.equal(t.network, "Tesla");
  assert.equal(t.lat, 31.898879);
  assert.equal(t.dc_ports, 8);
  assert.equal(m.stations[0].hours, "24 hours daily");
  assert.deepEqual(m.registry.ids, [1, 777, 201925]);
});

test("removals recorded with date; re-listing clears them", () => {
  const n1 = toStation(nrelBase, "t");
  const prev: Registry = { date: "2026-10-11", ids: [1, 2, 3, 4, 5], removed: {} };
  const heads = new Map([1, 2, 3, 4, 9].map((i) => [i, h("EVgo")]));
  const m = buildMirror([n1], heads, { details: {} }, prev, "2026-10-12", "t");
  assert.deepEqual(m.removed, [5]);
  assert.deepEqual(m.added, [9]);
  assert.equal(m.registry.removed[5].removed_on, "2026-10-12");
  const back = buildMirror([n1], new Map([1, 2, 3, 4, 5].map((i) => [i, h("EVgo")])), { details: {} }, m.registry, "2026-10-13", "t");
  assert.equal(back.registry.removed[5], undefined);
});

test("guard: short or failed fetch removes nothing", () => {
  const prev: Registry = { date: "2026-10-11", ids: [1, 2, 3, 4, 5], removed: {} };
  const m = buildMirror([toStation(nrelBase, "t")], new Map([[1, h("EVgo")]]), { details: {} }, prev, "2026-10-12", "t");
  assert.equal(m.guard_tripped, true);
  assert.deepEqual(m.removed, []);
  assert.deepEqual(m.registry.ids, [1, 2, 3, 4, 5]);
  assert.equal(buildMirror([], new Map(), { details: {} }, prev, "d", "t").guard_tripped, true);
});

test("coordinate match to an NREL record when ids differ", () => {
  const n = toStation({ ...nrelBase, id: 50, ev_network: "Tesla", latitude: 31.8989, longitude: -97.091 }, "t");
  const cache: DcfcCache = { details: { 201925: parseStationPage(tesla, 201925, "d") } };
  const m = buildMirror([n], new Map([[201925, h("Tesla")]]), cache, empty, "d", "t");
  assert.equal(m.stations[0].station_ref, "nrel:50");
  assert.equal(m.beyond_nrel, 0);
});

test("new stations get station pages first and over budget", () => {
  const heads = new Map([[1, h("EVgo")], [2, h("EVgo")], [3, h("EVgo")]]);
  assert.deepEqual(pickDetailIds(heads, { details: {} }, 1, new Set([1, 2])), [3, 1]);
});

test("price_changed_at follows the last change", () => {
  const days: { date: string; snap: Snapshot }[] = [
    { date: "2026-10-10", snap: { a: [0.5, null, null] as [number, null, null] } },
    { date: "2026-10-11", snap: { a: [0.5, null, null] as [number, null, null], b: [0.3, null, null] as [number, null, null] } },
    { date: "2026-10-12", snap: { a: [0.55, null, null] as [number, null, null], b: [0.3, null, null] as [number, null, null] } },
  ];
  const m = priceChangedAt(days);
  assert.equal(m.get("a"), "2026-10-12");
  assert.equal(m.get("b"), "2026-10-11");
});

test("Central ISO time", () => {
  assert.equal(centralIso(new Date("2026-10-13T06:00:00Z")), "2026-10-13T01:00:00-05:00");
  assert.equal(centralIso(new Date("2026-12-01T07:00:00Z")), "2026-12-01T01:00:00-06:00");
});
