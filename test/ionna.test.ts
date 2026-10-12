import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIonnaPage, applyIonnaPrices, extractLocations } from "../src/ionna.ts";
import { toStation, type NrelStation } from "../src/transform.ts";
import { snapshot } from "../src/history.ts";

const page = `<script>
window.allLocations = {"6007":{"title":"Yuma, AZ Rechargery","status":"open","price":"<span class=\\"rechargery_price_now\\">$0.39<\\/span>\\/kWh Plus tax","price_updated":null,"speed":"400","lat":"32.6855748","lon":"-114.0196144","link":"https:\\/\\/www.ionna.com\\/ev-charging-stations\\/az\\/yuma\\/x\\/","site_id":"AZ-0039","note":"a } brace"},
"7001":{"title":"Tampa, FL Rechargery","status":"open","price":"<span class=\\"rechargery_price_now\\">$0.20<\\/span>\\/kWh Plus tax","price_updated":" (Last Updated: Just Now) ","speed":"400","lat":"27.9","lon":"-82.4","link":null,"site_id":"FL-0001"},
"7002":{"title":"Soon","status":"soon","price":"","price_updated":null,"speed":"","lat":"","lon":"-82.4"}};
</script>`;

const base: NrelStation = {
  id: 9, station_name: "IONNA Yuma", street_address: "1 Main", city: "Yuma", state: "AZ", zip: "85365",
  latitude: 32.6857, longitude: -114.0196, ev_network: "IONNA", ev_dc_fast_num: 6, ev_connector_types: ["J1772COMBO", "TESLA"],
  ev_pricing: null, access_days_time: null, facility_type: null, open_date: null, date_last_confirmed: null, ev_charging_units: [],
};

test("extracts the locations object despite braces inside strings", () => {
  assert.equal(Object.keys(extractLocations(page)).length, 3);
  assert.throws(() => extractLocations("<html></html>"));
});

test("parses price, updated text, speed and coordinates", () => {
  const sites = parseIonnaPage(page);
  assert.equal(sites.length, 2);
  assert.equal(sites[0].price_per_kwh, 0.39);
  assert.equal(sites[0].price_text, "$0.39/kWh Plus tax");
  assert.equal(sites[0].speed_kw, 400);
  assert.equal(sites[0].link, "https://www.ionna.com/ev-charging-stations/az/yuma/x/");
  assert.equal(sites[1].price_per_kwh, 0.2);
  assert.equal(sites[1].price_updated, "Last Updated: Just Now");
});

test("matched station gets its posted price, unmatched keeps the ceiling", () => {
  const near = toStation(base, "x");
  const far = toStation({ ...base, id: 10, latitude: 33.5, longitude: -112.0 }, "x");
  const tampa = toStation({ ...base, id: 11, latitude: 27.9005, longitude: -82.4, ev_pricing: "$0.39 per kWh" }, "x");
  const n = applyIonnaPrices([near, far, tampa], parseIonnaPage(page), "2026-10-12");
  assert.equal(n, 2);
  assert.equal(near.price_source, "network_site");
  assert.equal(near.price_per_kwh, 0.39);
  assert.equal(near.verified_on, "2026-10-12");
  assert.equal(far.price_source, "published");
  assert.equal(far.price_per_kwh, 0.39);
  assert.equal(tampa.price_per_kwh, 0.2);
  assert.match(tampa.price_note ?? "", /Last Updated: Just Now/);
  const snap = snapshot([tampa, far]);
  assert.equal(snap[tampa.station_ref].length, 4);
  assert.equal(snap[far.station_ref].length, 3);
});

test("ignores non-IONNA stations and sites over 150 m away", () => {
  const evgo = toStation({ ...base, ev_network: "EVGO" }, "x");
  const off = toStation({ ...base, latitude: 32.6875 }, "x");
  assert.equal(applyIonnaPrices([evgo, off], parseIonnaPage(page), "d"), 0);
});
