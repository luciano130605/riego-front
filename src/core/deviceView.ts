import { latestReading } from './forecast';
import type { Reading, SensorFaultReason, Snapshot } from './types';

/**
 * Lo que muestran el panel de la placa, la tarjeta de humedad y el chip del encabezado, tomado TAL CUAL de lo que
 * informa el backend (`snapshot.device` y la última lectura). Acá no se decide nada: no se mira el valor crudo para
 * inventar un estado ni se calcula cuánto silencio alcanza para dar la placa por caída (eso lo dice `device.online`).
 * Lo único que se calcula con el reloj es "hace cuánto", que por eso recibe `now`.
 */

/** Cómo está el sensor según el servidor. */
export type SensorView =
  | { kind: 'ok' }
  /** Lectura pegada al máximo: no es una falla, casi siempre es que las púas no tocan la tierra o el cable AO. */
  | { kind: 'saturated' }
  /** Falla del sensor: ruido en la señal o lectura muy baja (el motivo puede no venir). */
  | { kind: 'fault'; reason?: Exclude<SensorFaultReason, 'high'> }
  /** El servidor no informa el estado del sensor. */
  | { kind: 'unknown' };

export type DeviceView = {
  /** `device.online`, sin tocar. */
  online: boolean;
  /**
   * Hace cuánto se dio la placa por desconectada (ms), o null si está en línea. Cuenta desde que se pasó el límite que
   * informa el servidor (`offlineAfterSec`): último reporte + ese límite. Si el servidor no informa el límite, desde
   * el último reporte.
   */
  offlineForMs: number | null;
  /** Una sola fuente para el valor crudo y la hora de la última lectura: siempre salen juntos de la misma lectura. */
  lastReading: Reading | undefined;
  sensor: SensorView;
};

export function sensorViewOf(device: Pick<Snapshot['device'], 'sensor'>): SensorView {
  const s = device.sensor;
  if (!s) return { kind: 'unknown' };
  if (s.ok) return { kind: 'ok' };
  if (s.reason === 'high') return { kind: 'saturated' };
  return { kind: 'fault', ...(s.reason ? { reason: s.reason } : {}) };
}

export function deviceView(snapshot: Pick<Snapshot, 'device' | 'readings'>, now: number): DeviceView {
  const { device } = snapshot;
  let offlineForMs: number | null = null;
  if (!device.online) {
    const since = device.offlineAfterSec !== undefined ? device.lastSeen + device.offlineAfterSec * 1000 : device.lastSeen;
    offlineForMs = device.lastSeen > 0 ? Math.max(0, now - since) : null;
  }
  return {
    online: device.online,
    offlineForMs,
    lastReading: latestReading(snapshot.readings, now),
    sensor: sensorViewOf(device),
  };
}
