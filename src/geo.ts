export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export interface Locatable { lat: number; lon: number; network: string }

/** Nearest candidate within maxMeters whose network matches. Used to attach outside price records to NREL stations. */
export function matchStation<T extends Locatable>(
  point: Locatable,
  candidates: T[],
  sameNetwork: (a: string, b: string) => boolean,
  maxMeters = 150,
): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const c of candidates) {
    if (!sameNetwork(point.network, c.network)) continue;
    const d = distanceMeters(point.lat, point.lon, c.lat, c.lon);
    if (d <= maxMeters && d < bestD) { best = c; bestD = d; }
  }
  return best;
}
