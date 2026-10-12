import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseStatePage, parseStationPage, pickDetailIds, applyDcfc, parseDate, type DcfcCache, type Headline } from "../src/dcfctracker.ts";
import { toStation, type NrelStation } from "../src/transform.ts";

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
const page = (n: string, id = 1) => parseStationPage(fx(`dcfc-station-${n}.html`), id, "2026-10-12");

const base: NrelStation = {
  id: 201925, station_name: "Abbott, TX - Tesla Supercharger", street_address: "I-35", city: "Abbott", state: "TX", zip: "76621",
  latitude: 31.898879, longitude: -97.090962, ev_network: "Tesla", ev_dc_fast_num: 8, ev_connector_types: ["TESLA"],
  ev_pricing: "$0.46 per kWh", access_days_time: "24 hours daily. Open to all EVs", facility_type: null, open_date: null, date_last_confirmed: null,
  ev_charging_units: [],
};

test("state page cards give id, network and headline price", () => {
  const m = parseStatePage(fx("dcfc-state.html"));
  assert.deepEqual(m.get(201925), { network: "Tesla", text: "$0.52/kWh", price_per_kwh: 0.52, per_minute: null, free: false });
  assert.equal(m.get(388971)?.network, "Blink");
});

test("Tesla page: public rate is the guest price, membership separate", () => {
  const d = page("tesla");
  assert.equal(d.guest.per_kwh, 0.52);
  assert.equal(d.member?.per_kwh, 0.38);
  assert.equal(d.source, "Tesla · Public Oct 12, 2026");
  assert.equal(d.source_date, "2026-10-12");
  assert.equal(d.lat, 31.898879);
});

test("Rivian page: other EVs is guest, idle fee per minute", () => {
  const d = page("rivian");
  assert.equal(d.guest.per_kwh, 0.65);
  assert.equal(d.member?.per_kwh, 0.55);
  assert.equal(d.guest.idle_fee, 0.5);
});

test("EVgo page: time-of-day rates", () => {
  const d = page("evgo");
  assert.equal(d.guest.per_kwh, 0.63);
  assert.equal(d.guest.time_of_day.length, 4);
  assert.deepEqual(d.guest.time_of_day[0], { start: "00:00", end: "08:00", price_per_kwh: 0.56, label: "Super Off-Peak" });
  assert.deepEqual(d.guest.time_of_day[3], { start: "16:00", end: "20:00", price_per_kwh: 0.63, label: "On-Peak" });
});

test("ChargePoint page: session and hourly idle fee", () => {
  const d = page("chargepoint");
  assert.equal(d.guest.per_kwh, 0.54);
  assert.equal(d.guest.session_fee, 0.99);
  assert.equal(d.guest.idle_fee, 0.3333);
  assert.equal(d.source_date, "2026-05-12");
});

test("dates", () => {
  assert.equal(parseDate("EVgo · Oct 2, 2026"), "2026-10-02");
  assert.equal(parseDate("nothing"), null);
});

test("detail picking: changed, then missing, then oldest", () => {
  const h = new Map<number, Headline>([
    [1, { network: "A", text: "$0.50/kWh", price_per_kwh: 0.5, per_minute: null, free: false }],
    [2, { network: "A", text: "$0.40/kWh", price_per_kwh: 0.4, per_minute: null, free: false }],
    [3, { network: "A", text: "$0.40/kWh", price_per_kwh: 0.4, per_minute: null, free: false }],
    [4, { network: "A", text: null, price_per_kwh: null, per_minute: null, free: false }],
  ]);
  const d = page("tesla");
  const cache: DcfcCache = { details: { 1: { ...d, guest: { ...d.guest, per_kwh: 0.5 }, fetched_on: "2026-10-01" }, 2: { ...d, guest: { ...d.guest, per_kwh: 0.3 } } } };
  assert.deepEqual(pickDetailIds(h, cache, 10), [2, 3, 1]);
  assert.deepEqual(pickDetailIds(h, cache, 1), [2]);
});

test("applies by NREL id, Tesla keeps non-member price and access flag", () => {
  const s = toStation(base, "x");
  const flag = s.open_to_non_tesla;
  const h = parseStatePage(fx("dcfc-state.html"));
  const r = applyDcfc([s], h, { details: { 201925: page("tesla", 201925) } }, "2026-10-12");
  assert.equal(r.by_id, 1);
  assert.equal(s.price_source, "dcfctracker");
  assert.equal(s.price_per_kwh, 0.52);
  assert.equal(s.member_price, 0.38);
  assert.equal(s.open_to_non_tesla, flag);
  assert.equal(s.source_url, "https://dcfctracker.com/stations/201925");
  assert.match(s.price_note ?? "", /Non-member/);
});

test("stale detail is ignored when the headline moved", () => {
  const s = toStation(base, "x");
  const h = new Map<number, Headline>([[201925, { network: "Tesla", text: "$0.55/kWh", price_per_kwh: 0.55, per_minute: null, free: false }]]);
  applyDcfc([s], h, { details: { 201925: page("tesla", 201925) } }, "2026-10-13");
  assert.equal(s.price_per_kwh, 0.55);
  assert.equal(s.member_price, null);
  assert.equal(s.verified_on, "2026-10-13");
});

test("falls back to location + network when the id is unknown", () => {
  const s = toStation({ ...base, id: 999 }, "x");
  const r = applyDcfc([s], new Map(), { details: { 201925: page("tesla", 201925) } }, "2026-10-12");
  assert.equal(r.by_coords, 1);
  assert.equal(s.price_per_kwh, 0.52);
  const other = toStation({ ...base, id: 998, ev_network: "eVgo Network" }, "x");
  assert.equal(applyDcfc([other], new Map(), { details: { 201925: page("tesla", 201925) } }, "2026-10-12").matched, 0);
});

test("a network's own posted price wins when it is as new or newer", () => {
  const s = toStation({ ...base, ev_network: "IONNA" }, "x");
  Object.assign(s, { price_source: "network_site", price_per_kwh: 0.2, verified_on: "2026-10-12" });
  const h = new Map<number, Headline>([[201925, { network: "IONNA", text: "$0.39/kWh", price_per_kwh: 0.39, per_minute: null, free: false }]]);
  applyDcfc([s], h, { details: {} }, "2026-10-12");
  assert.equal(s.price_per_kwh, 0.2);
  Object.assign(s, { verified_on: "2026-10-01" });
  applyDcfc([s], h, { details: {} }, "2026-10-12");
  assert.equal(s.price_per_kwh, 0.39);
});
