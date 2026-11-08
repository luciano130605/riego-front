import { describe, expect, it } from 'vitest';
import { deviceView, sensorViewOf } from './deviceView';
import type { DeviceStatus, Reading } from './types';

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const dev = (over: Partial<DeviceStatus> = {}): DeviceStatus => ({ online: true, lastSeen: NOW - MIN, readEveryMin: 15, ...over });
const reading = (t: number, raw = 2200): Reading => ({ t, raw, moisture: 50 });

describe('sensorViewOf: el estado del sensor es el que informa el servidor', () => {
  it('ok, falla con motivo, falla sin motivo y sin informar', () => {
    expect(sensorViewOf({ sensor: { ok: true } })).toEqual({ kind: 'ok' });
    expect(sensorViewOf({ sensor: { ok: false, reason: 'noise' } })).toEqual({ kind: 'fault', reason: 'noise' });
    expect(sensorViewOf({ sensor: { ok: false, reason: 'low' } })).toEqual({ kind: 'fault', reason: 'low' });
    expect(sensorViewOf({ sensor: { ok: false } })).toEqual({ kind: 'fault' });
    expect(sensorViewOf({})).toEqual({ kind: 'unknown' });
  });

  it('lectura al máximo (reason "high") es "saturado", no una falla', () => {
    expect(sensorViewOf({ sensor: { ok: false, reason: 'high' } })).toEqual({ kind: 'saturated' });
  });
});

describe('deviceView', () => {
  it('la conexión es device.online, sin recalcular: una lectura vieja con online=true sigue en línea', () => {
    const v = deviceView({ device: dev({ online: true, lastSeen: NOW - 10 * 60 * MIN }), readings: [] }, NOW);
    expect(v.online).toBe(true);
    expect(v.offlineForMs).toBeNull();
  });

  it('y una lectura fresca con online=false sigue desconectada', () => {
    const v = deviceView({ device: dev({ online: false, lastSeen: NOW - MIN }), readings: [] }, NOW);
    expect(v.online).toBe(false);
  });

  it('"sin conexión desde hace X" cuenta desde que se pasó el límite que informa el servidor', () => {
    // Último reporte hace 28 min, límite de 18 min: hace 10 min que se la dio por desconectada.
    const v = deviceView({ device: dev({ online: false, lastSeen: NOW - 28 * MIN, offlineAfterSec: 18 * 60 }), readings: [] }, NOW);
    expect(v.offlineForMs).toBe(10 * MIN);
  });

  it('si el servidor no informa el límite, cuenta desde el último reporte', () => {
    const v = deviceView({ device: dev({ online: false, lastSeen: NOW - 28 * MIN }), readings: [] }, NOW);
    expect(v.offlineForMs).toBe(28 * MIN);
  });

  it('nunca da un tiempo negativo y sin ningún reporte no hay "desde hace"', () => {
    expect(deviceView({ device: dev({ online: false, lastSeen: NOW - MIN, offlineAfterSec: 18 * 60 }), readings: [] }, NOW).offlineForMs).toBe(0);
    expect(deviceView({ device: dev({ online: false, lastSeen: 0 }), readings: [] }, NOW).offlineForMs).toBeNull();
  });

  it('con el reloj corrido, "hace cuánto" crece sin que lleguen datos nuevos', () => {
    const snapshot = { device: dev({ online: false, lastSeen: NOW - 28 * MIN, offlineAfterSec: 18 * 60 }), readings: [] };
    expect(deviceView(snapshot, NOW).offlineForMs).toBe(10 * MIN);
    expect(deviceView(snapshot, NOW + 30_000).offlineForMs).toBe(10 * MIN + 30_000);
  });

  it('la última lectura es una sola: valor y hora salen juntos de la misma lectura', () => {
    const readings = [reading(NOW - 30 * MIN, 2000), reading(NOW - 5 * MIN, 2300), reading(NOW + MIN, 9999)]; // la última es del futuro
    const v = deviceView({ device: dev({ lastRaw: 1111 }), readings }, NOW);
    expect(v.lastReading).toEqual({ t: NOW - 5 * MIN, raw: 2300, moisture: 50 }); // no mezcla con device.lastRaw
  });

  it('sin lecturas no hay última lectura', () => {
    expect(deviceView({ device: dev(), readings: [] }, NOW).lastReading).toBeUndefined();
  });
});
