/** Map NREL ev_network codes to display names. */
const NAMES: Record<string, string> = {
  "Tesla": "Tesla",
  "Electrify America": "Electrify America",
  "eVgo Network": "EVgo",
  "IONNA": "IONNA",
  "ChargePoint Network": "ChargePoint",
  "Blink Network": "Blink",
  "BP_PULSE": "bp pulse",
  "SHELL_RECHARGE": "Shell Recharge",
  "RIVIAN_ADVENTURE": "Rivian Adventure Network",
  "MERCEDES_BENZ": "Mercedes-Benz HPC",
  "RED_E": "Red E",
  "FCN": "Francis Energy",
  "WALMART": "Walmart",
  "EV Connect": "EV Connect",
  "FORD_CHARGE": "Ford Charge",
  "CIRCLE_K": "Circle K",
  "Non-Networked": "Non-networked",
};

export function networkName(raw: string | null | undefined): string {
  if (!raw) return "Unknown";
  if (NAMES[raw]) return NAMES[raw];
  return raw
    .toLowerCase()
    .split(/[_\s]+/)
    .map((w) => (w.length <= 3 && w !== "the" ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

export function sameNetwork(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/network|charging|ev/g, "");
  const x = norm(a), y = norm(b);
  return x.length > 0 && (x === y || x.includes(y) || y.includes(x));
}
