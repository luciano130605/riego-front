import { describe, expect, it } from 'vitest';
import type { Reading } from '@/core/types';
import { daySegments, hourTicks, nearestIndex, splitSegments, visibleReadings } from './chartMath';

const MIN = 60_000;
const H = 3_600_000;
// 5 de noviembre de 2026, 15:41 hora local.
const NOW = new Date(2026, 10, 5, 15, 41).getTime();

const r = (t: number, raw = 2000, moisture = 40): Reading => ({ t, raw, moisture });

describe('visibleReadings', () => {
  it('descarta las lecturas fuera del tramo y los valores imposibles', () => {
    const all = [r(NOW - 30 * H), r(NOW - 2 * H), r(NOW - H, 4095), r(NOW)];
    expect(visibleReadings(all, NOW, '24h').map((p) => p.t)).toEqual([NOW - 2 * H, NOW]);
    expect(visibleReadings(all, NOW, '7d')).toHaveLength(3);
  });
});

describe('splitSegments', () => {
  it('corta la línea donde faltan lecturas', () => {
    const pts = [r(0), r(15 * MIN), r(30 * MIN), r(5 * H), r(5 * H + 15 * MIN)];
    const segs = splitSegments(pts, 40 * MIN);
    expect(segs.map((s) => s.length)).toEqual([3, 2]);
  });

  it('devuelve vacío sin datos', () => {
    expect(splitSegments([], 1000)).toEqual([]);
  });
});

describe('nearestIndex', () => {
  const pts = [{ t: 0 }, { t: 100 }, { t: 200 }];
  it('encuentra la lectura más cercana', () => {
    expect(nearestIndex(pts, 40)).toBe(0);
    expect(nearestIndex(pts, 60)).toBe(1);
    expect(nearestIndex(pts, 500)).toBe(2);
    expect(nearestIndex([], 1)).toBe(-1);
  });
});

describe('hourTicks', () => {
  it('marca cada 6 horas en punto dentro de las últimas 24 h', () => {
    const ticks = hourTicks(NOW);
    expect(ticks.map((t) => new Date(t).getHours())).toEqual([18, 0, 6, 12]);
    expect(ticks.every((t) => t > NOW - 24 * H && t <= NOW)).toBe(true);
  });
});

describe('daySegments', () => {
  it('arma un tramo por día y centra el rótulo', () => {
    const segs = daySegments(NOW);
    // Entre jue 29 a las 15:41 y hoy a las 15:41 hay 7 días y fracciones.
    expect(segs.length).toBeGreaterThanOrEqual(7);
    for (const s of segs) expect(s.mid).toBe((s.start + s.end) / 2);
    expect(segs[segs.length - 1].end).toBe(NOW);
    expect(segs[0].start).toBe(NOW - 7 * 24 * H);
  });

  it('descarta los tramos de borde demasiado cortos', () => {
    // A las 02:00 de hoy, "hoy" solo tiene 2 h: no entra un rótulo.
    const early = new Date(2026, 10, 5, 2, 0).getTime();
    const segs = daySegments(early);
    expect(segs[segs.length - 1].end).toBeLessThan(early);
  });
});
