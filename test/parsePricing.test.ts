import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePricing } from "../src/parsePricing.ts";

test("flat per kWh", () => {
  const p = parsePricing("$0.48 per kWh");
  assert.equal(p.price_per_kwh, 0.48);
  assert.equal(p.parsed, true);
});
test("free", () => {
  const p = parsePricing("Free");
  assert.equal(p.free, true);
  assert.equal(p.price_per_kwh, 0);
});
test("peak / off-peak", () => {
  const p = parsePricing("$0.47 Peak / $0.30 Off-Peak per kWh");
  assert.equal(p.price_per_kwh, 0.47);
  assert.equal(p.off_peak, 0.3);
});
test("connection fee", () => {
  const p = parsePricing("$0.50 per kWh + $1 connection");
  assert.equal(p.price_per_kwh, 0.5);
  assert.equal(p.session_fee, 1);
});
test("time window", () => {
  const p = parsePricing("$0.45 per kWh from 4pm-9pm; $0.30 per kWh all other times");
  assert.equal(p.price_per_kwh, 0.45);
  assert.deepEqual(p.time_of_day.map((t) => [t.start, t.end, t.price_per_kwh]), [["16:00", "21:00", 0.45], ["21:00", "16:00", 0.3]]);
});
test("DC portion with idle fee", () => {
  const p = parsePricing("DC: $0.32 per kWh while charging + $12 per hour idle fee; L2: $0.28 per kWh + $2 per hour idle fee");
  assert.equal(p.price_per_kwh, 0.32);
  assert.equal(p.idle_fee, 0.2);
  assert.equal(p.per_minute, null);
});
test("per minute with fee", () => {
  const p = parsePricing("$1.00 connection fee; $0.12 per min (75kW); $0.22 per min (100kW)");
  assert.equal(p.per_minute, 0.12);
  assert.equal(p.session_fee, 1);
  assert.equal(p.price_per_kwh, null);
});
test("range TOU", () => {
  const p = parsePricing("$0.48-$0.64 per kWh TOU+$1 connection");
  assert.equal(p.price_per_kwh, 0.64);
  assert.equal(p.off_peak, 0.48);
  assert.equal(p.session_fee, 1);
});
test("no price", () => {
  assert.equal(parsePricing("Please download 7Charge app for current pricing.").parsed, false);
  assert.equal(parsePricing(null).parsed, false);
});
