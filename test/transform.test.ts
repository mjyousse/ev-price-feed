import { test } from "node:test";
import assert from "node:assert/strict";
import { toStation, openToNonTesla, type NrelStation } from "../src/transform.ts";
import { matchStation, distanceMeters } from "../src/geo.ts";
import { sameNetwork } from "../src/networks.ts";
import { snapshot, diffSnapshots } from "../src/history.ts";

const base: NrelStation = {
  id: 1, station_name: "Test", street_address: "1 Main", city: "Round Rock", state: "TX", zip: "78664",
  latitude: 30.5, longitude: -97.7, ev_network: "Tesla", ev_dc_fast_num: 8, ev_connector_types: ["TESLA"],
  ev_pricing: null, access_days_time: "24 hours daily. Open to Teslas only.", facility_type: null, open_date: null, date_last_confirmed: null,
  ev_charging_units: [{ charging_level: "dc_fast", connectors: { TESLA: { power_kw: 250, port_count: 8 } } }],
};

test("Tesla-only flag", () => {
  assert.equal(openToNonTesla(base), false);
  assert.equal(openToNonTesla({ ...base, access_days_time: "24 hours daily", ev_connector_types: ["TESLA", "J1772COMBO"] }), true);
  assert.equal(openToNonTesla({ ...base, access_days_time: "24 hours daily" }), null);
});
test("max kW and connectors", () => {
  const s = toStation(base, "2026-10-12T00:00:00Z");
  assert.equal(s.max_kw, 250);
  assert.deepEqual(s.connectors, ["NACS"]);
  assert.equal(s.price_source, "none");
});
test("published IONNA tariff applies when NREL has no price", () => {
  const s = toStation({ ...base, ev_network: "IONNA", access_days_time: null, ev_connector_types: ["J1772COMBO", "TESLA"] }, "x");
  assert.equal(s.price_per_kwh, 0.39);
  assert.equal(s.price_source, "published");
});
test("MB Power Hours by city", () => {
  const s = toStation({ ...base, ev_network: "MERCEDES_BENZ" }, "x");
  assert.equal(s.time_of_day[0].price_per_kwh, 0.23);
});
test("NREL price wins over tariff", () => {
  const s = toStation({ ...base, ev_network: "IONNA", ev_pricing: "$0.20 per kWh" }, "x");
  assert.equal(s.price_per_kwh, 0.2);
  assert.equal(s.price_source, "nrel");
});
test("matching within 150 m and same network", () => {
  const cands = [{ lat: 30.5, lon: -97.7, network: "IONNA" }, { lat: 30.5005, lon: -97.7, network: "EVgo" }];
  assert.ok(distanceMeters(30.5, -97.7, 30.501, -97.7) > 100);
  assert.equal(matchStation({ lat: 30.5004, lon: -97.7, network: "EVgo" }, cands, sameNetwork)?.network, "EVgo");
  assert.equal(matchStation({ lat: 30.51, lon: -97.7, network: "IONNA" }, cands, sameNetwork), null);
});
test("history diff", () => {
  const a = snapshot([toStation({ ...base, ev_pricing: "$0.50 per kWh" }, "x")]);
  const b = snapshot([toStation({ ...base, ev_pricing: "$0.45 per kWh" }, "x")]);
  assert.deepEqual(diffSnapshots([{ date: "d1", snap: a }, { date: "d2", snap: b }]), [{ station_ref: "nrel:1", date: "d2", from: 0.5, to: 0.45 }]);
});
