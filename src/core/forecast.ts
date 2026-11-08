import type { Reading, WaterEvent } from './types';

const H = 3_600_000;

/** Después de un riego la tierra tarda en repartir el agua: se ignora ese tramo. */
export const SETTLE_MS = 90 * 60_000;

export type Forecast =
  | { kind: 'now' }
  | { kind: 'in'; hours: number; ratePerHour: number }
  | { kind: 'stable' }
  | { kind: 'far' }
  | { kind: 'unknown' };

export function latestReading(readings: Reading[], now: number): Reading | undefined {
  let best: Reading | undefined;
  for (const r of readings) {
    if (r.t <= now && (!best || r.t > best.t)) best = r;
  }
  return best;
}

/**
 * Cuánto baja la humedad por hora (negativo = se está secando).
 * Regresión lineal sobre las lecturas posteriores al último riego.
 * Devuelve null si no hay datos suficientes para confiar en la pendiente.
 */
export function dryingRate(
  readings: Reading[],
  events: WaterEvent[],
  now: number,
  windowHours = 36,
): number | null {
  let lastWater = 0;
  for (const e of events) if (e.t <= now && e.t > lastWater) lastWater = e.t;

  const from = Math.max(now - windowHours * H, lastWater > 0 ? lastWater + SETTLE_MS : 0);
  const pts = readings.filter((r) => r.t >= from && r.t <= now).sort((a, b) => a.t - b.t);
  if (pts.length < 4) return null;

  const t0 = pts[0].t;
  if (pts[pts.length - 1].t - t0 < 3 * H) return null;

  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of pts) {
    const x = (p.t - t0) / H;
    sx += x;
    sy += p.moisture;
    sxx += x * x;
    sxy += x * p.moisture;
  }
  const n = pts.length;
  const den = n * sxx - sx * sx;
  if (den === 0) return null;
  return (n * sxy - sx * sy) / den;
}

/** Cuándo va a cruzar el umbral, si sigue secándose al ritmo actual. */
export function forecastWatering(
  readings: Reading[],
  events: WaterEvent[],
  thresholdPct: number,
  now: number,
): Forecast {
  const last = latestReading(readings, now);
  if (!last) return { kind: 'unknown' };
  if (last.moisture < thresholdPct) return { kind: 'now' };

  const rate = dryingRate(readings, events, now);
  if (rate === null) return { kind: 'unknown' };
  // Menos de ~0,5 puntos por día: para el caso práctico, no se está secando.
  if (rate > -0.02) return { kind: 'stable' };

  const hours = (last.moisture - thresholdPct) / -rate;
  if (hours > 14 * 24) return { kind: 'far' };
  return { kind: 'in', hours, ratePerHour: -rate };
}
