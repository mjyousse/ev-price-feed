# EV Price Feed

A daily, open feed of US DC fast charging stations with pricing, built for
[DCFC Tracker for iOS](https://github.com/mjyousse/dcfc-ios),
[EV Planner](https://github.com/mjyousse/ev-planner-ios) and
[EV Planner Web](https://github.com/mjyousse/ev-planner-web).

Made by **Mohammad Youssef**.

## Feed

Base URL: `https://mjyousse.github.io/ev-price-feed/`

| File | Contents |
| --- | --- |
| `meta.json` | Generation time, counts per network, list of state shards, sources |
| `states/{ST}.json` | Stations for one state (recommended for apps, ~0.1-1 MB each) |
| `prices.json` | Every station in one file (~12 MB) |
| `history/index.json` | Available snapshot dates and every price change seen (last 120 days) |
| `history/{YYYY-MM-DD}.json` | Daily snapshot: `station_ref -> [price_per_kwh, per_minute, off_peak_price]` |

The feed refreshes every day at 09:17 UTC and can be run manually from the Actions tab.

### Station record

```jsonc
{
  "network": "IONNA",               // display name
  "network_raw": "IONNA",           // NREL network code
  "station_ref": "nrel:312345",     // stable id; nrel_id is the AFDC station id
  "nrel_id": 312345,
  "name": "...", "address": "...", "city": "...", "state": "TX", "zip": "...",
  "lat": 32.74, "lon": -96.82,
  "dc_ports": 8,
  "connectors": ["CCS", "NACS"],
  "max_kw": 400,                    // highest DC connector power reported, null if unknown
  "open_to_non_tesla": true,        // false = Tesla-only site, null = unknown
  "hours": "24 hours daily",
  "facility_type": "CONVENIENCE_STORE",
  "open_date": "2026-03-01",
  "last_confirmed": "2026-09-30",

  "price_per_kwh": 0.39,            // guest / non-member $ per kWh (peak if time-of-use)
  "member_price": null,             // $ per kWh with a membership, when published
  "off_peak_price": null,           // off-peak $ per kWh when hours are not published
  "per_minute": null,               // $ per minute charging (per-minute networks)
  "session_fee": null,              // flat $ per session
  "idle_fee": null,                 // $ per minute idle
  "time_of_day": [                  // local-time windows, may wrap midnight
    { "start": "21:00", "end": "08:00", "price_per_kwh": 0.23, "label": "Power Hours (off-peak)" }
  ],
  "free": false,
  "currency": "USD",
  "price_source": "published",      // "nrel" | "published" | "network_site" | "dcfctracker" | "none"
  "price_note": "...",
  "pricing_text": null,             // original NREL pricing text
  "source_url": "https://...",
  "verified_on": "2026-10-12",
  "fetched_at": "2026-10-12T09:17:00.000Z"
}
```

Prices are what the network or station operator has published and may not include
tax, session or idle fees unless listed. The charger screen or network app is always
the final word.

## Sources

| Source | How it is used |
| --- | --- |
| [NREL Alternative Fuels Data Center](https://developer.nlr.gov/docs/transportation/alt-fuel-stations-v1/) | All public DC fast stations, ports, connectors, power, hours, access notes and station-level pricing text. Official open data API. |
| [DCFC Tracker](https://dcfctracker.com) | Per-station prices (guest and member rates, per-minute, session and idle fees, time of day, source date). Collected with the site owner's permission, once per daily run: state pages for current prices plus a capped, rotating set of station pages for full tariffs (cached in `data/dcfc/`). Matched by NREL id, else location within 150 m and network. Highest priority, except where a network's own posted price is as new or newer. Tesla stays at the non-member rate. |
| [IONNA station locator](https://www.ionna.com/rechargeries/find-a-rechargery/) | Per-station price posted on the public locator, fetched once per run (honours robots.txt crawl-delay) and matched to NREL stations within 150 m. Overrides NREL text for IONNA. |
| [IONNA pricing](https://www.ionna.com/blog/public-ev-charging-prices/) | Published network-wide maximum of $0.39/kWh, fallback for IONNA stations not matched on the locator. |
| [Mercedes-Benz HPC Power Hours](https://mercedesbenzhpc.com/power-hours/) | Published off-peak rates and hours per location. |

Published tariffs live in [`src/tariffs.ts`](src/tariffs.ts) with the page they came from
and the date they were checked. Network websites are not crawled.

## Running locally

```bash
npm ci
npm test
NREL_API_KEY=your_key npm run build-feed   # writes public/ and data/history/
```

Get a free key at [developer.nlr.gov/signup](https://developer.nlr.gov/signup/).

DCFC Tracker options: `DCFC_DETAIL_LIMIT` (station pages per run, default 500), `DCFC_DELAY_MS` (pause between requests, default 2000), `DCFC_STATES` (comma list, for testing) and `DCFC_DISABLE=1` to skip it.

## Setup (one time)

1. Add a repository secret named `NREL_API_KEY` (Settings → Secrets and variables → Actions).
2. Settings → Pages → Source: **GitHub Actions**.
3. Run the **Update feed** workflow once from the Actions tab.

## License

[MIT](LICENSE) © 2026 Mohammad Youssef
