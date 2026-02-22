import dayjs from "dayjs";

/** Generate a human-readable order number: LE-YYYYMMDD-NNN */
export function generateOrderNumber(seq: number): string {
  return `LE-${dayjs().format("YYYYMMDD")}-${String(seq).padStart(3, "0")}`;
}

/** Generate route number: RT-YYYYMMDD-{WAVE}-NN */
export function generateRouteNumber(waveLabel: string, seq: number): string {
  const datePart = dayjs().format("YYYYMMDD");
  const wavePart = waveLabel.includes("AM") ? "AM" : "PM";
  return `RT-${datePart}-${wavePart}-${String(seq).padStart(2, "0")}`;
}

/** Generate invoice number: INV-YYYYMMDD-NNN */
export function generateInvoiceNumber(seq: number): string {
  return `INV-${dayjs().format("YYYYMMDD")}-${String(seq).padStart(3, "0")}`;
}

/** Haversine distance between two lat/lng points in km */
export function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Round a number to N decimal places */
export function round(n: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/** Clamp value between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
