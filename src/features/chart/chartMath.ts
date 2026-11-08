import { isSaneRaw } from '@/core/moisture';
import type { Reading } from '@/core/types';

export type Range = '24h' | '7d';

const H = 3_600_000;
export const SPAN_MS: Record<Range, number> = { '24h': 24 * H, '7d': 7 * 24 * H };

/** Lecturas del tramo visible que sirven para dibujar (se descartan los valores imposibles). */
export function visibleReadings(readings: Reading[], now: number, range: Range): Reading[] {
  const from = now - SPAN_MS[range];
  return readings.filter((r) => r.t >= from && r.t <= now && isSaneRaw(r.raw));
}

/** Parte la serie en tramos continuos: si faltan lecturas, la línea se corta en vez de unir el hueco. */
export function splitSegments(points: Reading[], maxGapMs: number): Reading[][] {
  const out: Reading[][] = [];
  let cur: Reading[] = [];
  for (const p of points) {
    const prev = cur[cur.length - 1];
    if (prev && p.t - prev.t > maxGapMs) {
      out.push(cur);
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Índice de la lectura más cercana a `t`. Requiere la lista ordenada por tiempo. */
export function nearestIndex(points: { t: number }[], t: number): number {
  if (points.length === 0) return -1;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && t - points[lo - 1].t < points[lo].t - t) return lo - 1;
  return lo;
}

/** Marcas del eje horizontal en 24 h: cada 6 horas en punto. */
export function hourTicks(now: number): number[] {
  const from = now - SPAN_MS['24h'];
  const d = new Date(from);
  d.setMinutes(0, 0, 0);
  const ticks: number[] = [];
  while (d.getTime() <= now) {
    const t = d.getTime();
    if (t >= from && d.getHours() % 6 === 0) ticks.push(t);
    d.setHours(d.getHours() + 1);
  }
  return ticks;
}

/**
 * Un tramo por cada día de calendario dentro de los últimos 7 días. Sirve para
 * rotular el eje con el nombre del día, centrado en su tramo. Los tramos
 * cortados (el primero y el de hoy) se descartan si miden menos de `minMs`,
 * porque no entra un rótulo.
 */
export function daySegments(now: number, minMs = 8 * H): { start: number; end: number; mid: number }[] {
  const from = now - SPAN_MS['7d'];
  const out: { start: number; end: number; mid: number }[] = [];
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  while (d.getTime() <= now) {
    const dayStart = d.getTime();
    d.setDate(d.getDate() + 1);
    const start = Math.max(dayStart, from);
    const end = Math.min(d.getTime(), now);
    if (end - start >= minMs) out.push({ start, end, mid: (start + end) / 2 });
  }
  return out;
}
