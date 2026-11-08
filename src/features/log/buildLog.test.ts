import { describe, expect, it } from 'vitest';
import type { Reading, Settings, Snapshot, WaterEvent } from '@/core/types';
import { buildLog } from './buildLog';

const MIN = 60_000;
const H = 3_600_000;
const NOW = 1_800_000_000_000;

const settings: Settings = {
  auto: true,
  mode: 'fixed',
  thresholdPct: 35,
  targetPct: 55,
  waterSeconds: 8,
  maxCycleSeconds: 30,
  minIntervalHours: 6,
  maxPerDay: 2,
  rawDry: 3100,
  rawWet: 1350,
};

function snap(readings: Reading[], events: WaterEvent[] = []): Snapshot {
  const last = readings[readings.length - 1];
  return {
    load: 'ready',
    now: NOW,
    readings,
    events,
    settings,
    device: { online: true, lastSeen: last?.t ?? 0, readEveryMin: 15 },
    isDemo: true,
  };
}

/** Lecturas cada 15 min terminando en NOW, con la humedad indicada de la más vieja a la más nueva. */
function series(values: number[], raw = 2000): Reading[] {
  return values.map((moisture, i) => ({
    t: NOW - (values.length - 1 - i) * 15 * MIN,
    raw,
    moisture,
  }));
}

describe('buildLog', () => {
  it('lista los riegos con su origen y duración', () => {
    const events: WaterEvent[] = [
      { t: NOW - H, seconds: 8, source: 'auto' },
      { t: NOW - 10 * MIN, seconds: 5, source: 'manual' },
    ];
    const log = buildLog(snap(series([50, 50, 50]), events));
    expect(log.map((l) => l.text)).toEqual(['Riego a mano, 5 s', 'Riego automático, 8 s']);
  });

  it('muestra un riego de varias tandas como una sola entrada', () => {
    const events: WaterEvent[] = [
      { t: NOW - 3 * H, seconds: 5, source: 'auto' },
      { t: NOW - 3 * H + 45 * MIN, seconds: 5, source: 'auto' },
      { t: NOW - 3 * H + 90 * MIN, seconds: 5, source: 'auto' },
    ];
    const log = buildLog(snap(series([50, 50, 50]), events));
    expect(log).toHaveLength(1);
    expect(log[0].text).toBe('Riego automático, 15 s en 3 tandas');
    expect(log[0].t).toBe(NOW - 3 * H);
  });

  it('marca cuando la humedad cruza el umbral hacia abajo y hacia arriba', () => {
    const log = buildLog(snap(series([40, 36, 34, 33, 38, 41])));
    const kinds = log.map((l) => l.kind);
    expect(kinds).toContain('dry');
    expect(kinds).toContain('recovered');
    expect(log.find((l) => l.kind === 'dry')?.text).toBe('La humedad bajó de 35 %');
  });

  it('no inventa cruces si la humedad se mantiene del mismo lado', () => {
    expect(buildLog(snap(series([50, 49, 48, 47])))).toEqual([]);
  });

  it('avisa un valor imposible del sensor y cuando vuelve a la normalidad', () => {
    const readings: Reading[] = [
      { t: NOW - 45 * MIN, raw: 2000, moisture: 50 },
      { t: NOW - 30 * MIN, raw: 4095, moisture: 0 },
      { t: NOW - 15 * MIN, raw: 4095, moisture: 0 },
      { t: NOW, raw: 2000, moisture: 50 },
    ];
    const log = buildLog(snap(readings));
    expect(log.map((l) => l.kind)).toEqual(['back', 'fault']);
    expect(log[1].text).toBe('El sensor dio un valor imposible (4095)');
  });

  it('detecta huecos de lecturas y cuando vuelven', () => {
    const readings: Reading[] = [
      { t: NOW - 5 * H, raw: 2000, moisture: 50 },
      { t: NOW, raw: 2000, moisture: 50 },
    ];
    const log = buildLog(snap(readings));
    expect(log).toHaveLength(1);
    expect(log[0].text).toBe('Volvieron las lecturas tras 5 h sin datos');
  });

  it('si las lecturas se cortaron, marca el momento en que se dio por caído', () => {
    const readings: Reading[] = [{ t: NOW - 3 * H, raw: 2000, moisture: 50 }];
    const log = buildLog(snap(readings));
    expect(log.map((l) => l.text)).toEqual(['El sensor dejó de enviar datos']);
    expect(log[0].t).toBe(NOW - 3 * H + 45 * MIN);
  });

  it('respeta el límite y ordena del más nuevo al más viejo', () => {
    const events: WaterEvent[] = Array.from({ length: 10 }, (_, i) => ({
      t: NOW - i * 3 * H,
      seconds: 8,
      source: 'auto' as const,
    }));
    const log = buildLog(snap(series([50]), events), 4);
    expect(log).toHaveLength(4);
    expect(log[0].t).toBeGreaterThan(log[3].t);
  });
});

describe('buildLog: wifi', () => {
  const base = () => snap([]);

  it('anota "Wi-Fi actualizado" con la red cuando la placa se conectó con otra', () => {
    const s = base();
    const log = buildLog({ ...s, device: { ...s.device, ssid: 'Lo-de-Ana', lastWifiChange: s.now - 3_600_000 } });
    expect(log.find((e) => e.kind === 'wifi')?.text).toBe('Wi-Fi actualizado: Lo-de-Ana');
  });

  it('mientras la placa espera una red nueva (wifiResetAt) todavía no hay "actualizado"', () => {
    const s = base();
    const log = buildLog({ ...s, device: { ...s.device, lastWifiChange: s.now - 60_000, wifiResetAt: s.now - 60_000 } });
    expect(log.some((e) => e.kind === 'wifi')).toBe(false);
  });

  it('sin cambios de wifi no hay entrada', () => {
    expect(buildLog(base()).some((e) => e.kind === 'wifi')).toBe(false);
  });
});
