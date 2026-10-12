import type { TimeOfDayRate } from "./types.ts";

export interface ParsedPricing {
  price_per_kwh: number | null;
  per_minute: number | null;
  session_fee: number | null;
  idle_fee: number | null;
  peak: number | null;
  off_peak: number | null;
  time_of_day: TimeOfDayRate[];
  free: boolean;
  /** true when the text names a price we could read */
  parsed: boolean;
}

const money = String.raw`\$\s?(\d+(?:\.\d+)?)`;

function to24(h: string, ap: string): string {
  let n = parseInt(h, 10) % 12;
  if (ap.toLowerCase() === "pm") n += 12;
  return `${String(n).padStart(2, "0")}:00`;
}

/** Keep only the DC portion when a text describes DC and L2 rates. */
function dcPortion(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  const dc = t.match(/DC[^:;]*:\s*([^;]*?)(?:;\s*L2|$)/i);
  if (dc) return dc[1];
  const forDc = t.match(new RegExp(money + String.raw`\s*per\s*kWh\s*for\s*DC`, "i"));
  if (forDc) return `$${forDc[1]} per kWh`;
  return t;
}

/** Parse NREL's free-text ev_pricing field into structured fields. Conservative: unknown stays null. */
export function parsePricing(raw: string | null | undefined): ParsedPricing {
  const out: ParsedPricing = {
    price_per_kwh: null, per_minute: null, session_fee: null, idle_fee: null,
    peak: null, off_peak: null, time_of_day: [], free: false, parsed: false,
  };
  if (!raw) return out;
  const text = dcPortion(raw);
  if (/^\s*free\b/i.test(text) && !/\$/.test(text)) {
    out.free = true; out.price_per_kwh = 0; out.parsed = true; return out;
  }

  const peak = text.match(new RegExp(money + String.raw`\s*Peak\s*/\s*` + money + String.raw`\s*Off-?Peak`, "i"));
  if (peak) {
    out.peak = +peak[1]; out.off_peak = +peak[2]; out.price_per_kwh = out.peak;
  }

  const range = text.match(new RegExp(money + "\\s*-\\s*" + money + String.raw`\s*per\s*kWh`, "i"));
  if (!peak && range) {
    out.off_peak = +range[1]; out.peak = +range[2]; out.price_per_kwh = out.peak;
  }

  const window = text.match(new RegExp(money + String.raw`\s*per\s*kWh\s*from\s*(\d{1,2})\s*(am|pm)\s*-\s*(\d{1,2})\s*(am|pm)[;,]?\s*` + money + String.raw`\s*per\s*kWh\s*all other times`, "i"));
  if (window) {
    const p = +window[1], o = +window[6];
    const start = to24(window[2], window[3]), end = to24(window[4], window[5]);
    out.peak = p; out.off_peak = o; out.price_per_kwh = p;
    out.time_of_day = [
      { start, end, price_per_kwh: p, label: "peak" },
      { start: end, end: start, price_per_kwh: o, label: "off-peak" },
    ];
  }

  if (out.price_per_kwh === null) {
    const kwh = text.match(new RegExp(money + String.raw`\s*(?:/|per)\s*kWh`, "i"));
    if (kwh) out.price_per_kwh = +kwh[1];
  }

  const idle = text.match(new RegExp(money + String.raw`\s*(?:/|per)\s*(min(?:ute)?|hour|hr)\s*idle`, "i"));
  if (idle) out.idle_fee = idle[2].toLowerCase().startsWith("h") ? +(+idle[1] / 60).toFixed(4) : +idle[1];

  const textNoIdle = idle ? text.replace(idle[0], "") : text;
  const perMin = textNoIdle.match(new RegExp(money + String.raw`\s*(?:/|per)\s*min(?:ute)?\b`, "i"));
  if (perMin) out.per_minute = +perMin[1];
  const perHour = textNoIdle.match(new RegExp(money + String.raw`\s*(?:/|per)\s*(?:hour|hr)\b`, "i"));
  if (!perMin && perHour) out.per_minute = +(+perHour[1] / 60).toFixed(4);

  const fee = text.match(new RegExp(money + String.raw`\s*(?:connection|activation|session|plug-?in|start)(?:\s*fee)?`, "i"));
  if (fee) out.session_fee = +fee[1];

  out.parsed = out.price_per_kwh !== null || out.per_minute !== null;
  return out;
}
