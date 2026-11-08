import { describe, expect, it } from 'vitest';
import { dryingRate, forecastWatering, SETTLE_MS } from './forecast';
import type { Reading, WaterEvent } from './types';

const H = 3_600_000;
const STEP = 15 * 60_000;
const NOW = 1_800_000_000_000;

/** Lecturas cada 15 min entre `from` y NOW con la humedad que devuelva `moistureAt`. */
function series(from: number, moistureAt: (t: number) => number): Reading[] {
  const out: Reading[] = [];
  for (let t = from; t <= NOW; t += STEP) out.push({ t, raw: 2000, moisture: moistureAt(t) });
  return out;
}

describe('forecastWatering', () => {
  it('estima cuándo cruza el umbral con una caída constante', () => {
    // Baja 0,5 puntos por hora durante 12 h: ahora está en 44.
    const readings = series(NOW - 12 * H, (t) => 50 - 0.5 * ((t - (NOW - 12 * H)) / H));
    const f = forecastWatering(readings, [], 35, NOW);
    expect(f.kind).toBe('in');
    if (f.kind === 'in') {
      expect(f.hours).toBeCloseTo(18, 1);
      expect(f.ratePerHour).toBeCloseTo(0.5, 3);
    }
  });

  it('devuelve "now" si la última lectura ya está bajo el umbral', () => {
    const readings = series(NOW - 6 * H, () => 30);
    expect(forecastWatering(readings, [], 35, NOW)).toEqual({ kind: 'now' });
  });

  it('devuelve "stable" si la humedad no baja', () => {
    const readings = series(NOW - 12 * H, () => 55);
    expect(forecastWatering(readings, [], 35, NOW)).toEqual({ kind: 'stable' });
  });

  it('devuelve "far" si va a tardar más de dos semanas', () => {
    // 0,025 puntos por hora: faltan 1000 h para bajar de 60 a 35.
    const readings = series(NOW - 12 * H, (t) => 60 - 0.025 * ((t - (NOW - 12 * H)) / H));
    expect(forecastWatering(readings, [], 35, NOW).kind).toBe('far');
  });

  it('devuelve "unknown" con pocas lecturas o muy poco rango de tiempo', () => {
    expect(forecastWatering([], [], 35, NOW)).toEqual({ kind: 'unknown' });
    const short = series(NOW - 1 * H, () => 50);
    expect(forecastWatering(short, [], 35, NOW)).toEqual({ kind: 'unknown' });
  });
});

describe('dryingRate', () => {
  it('ignora el tramo posterior a un riego, cuando la humedad sube', () => {
    const watered = NOW - 10 * H;
    const events: WaterEvent[] = [{ t: watered, seconds: 8, source: 'auto' }];
    const readings = series(watered, (t) => {
      const dt = t - watered;
      // Sube durante el tiempo de reparto del agua y después baja 0,4 puntos por hora.
      return dt < SETTLE_MS ? 40 + (20 * dt) / SETTLE_MS : 60 - 0.4 * ((dt - SETTLE_MS) / H);
    });
    expect(dryingRate(readings, events, NOW)).toBeCloseTo(-0.4, 3);
  });

  it('devuelve null si después del riego no alcanza el rango de 3 h', () => {
    const watered = NOW - 3 * H;
    const events: WaterEvent[] = [{ t: watered, seconds: 8, source: 'manual' }];
    const readings = series(watered, () => 50);
    expect(dryingRate(readings, events, NOW)).toBeNull();
  });
});
