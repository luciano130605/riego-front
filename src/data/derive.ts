import { groupCycles, openCycle, type Cycle } from '@/core/cycles';
import { decideWatering, type Decision } from '@/core/decide';
import { forecastWatering, latestReading, type Forecast } from '@/core/forecast';
import { levelOf, type Level } from '@/core/moisture';
import { wifiState, type WifiState } from '@/core/wifi';
import type { Reading, Snapshot, WaterEvent } from '@/core/types';

const H = 3_600_000;
const DAY = 24 * H;

export type Status = 'ok' | 'dry' | 'wet' | 'error';

export type Derived = {
  reading: Reading | undefined;
  /** error = la última lectura no sirve (valor imposible) o no hay ninguna. */
  status: Status;
  level: Level | undefined;
  /** La última lectura es vieja: se muestra, pero puede no ser la humedad de ahora. */
  stale: boolean;
  forecast: Forecast;
  decision: Decision;
  lastWater: WaterEvent | undefined;
  /** El último riego completo (varias tandas seguidas cuentan como uno). */
  lastCycle: Cycle | undefined;
  /** Riego automático que todavía puede seguir con otra tanda. */
  openCycle: Cycle | undefined;
  /** Riegos de los últimos 7 días y de los 7 anteriores (null si no hay datos de esa semana). */
  weekly: { count: number; previous: number | null };
  /** Cuándo se espera la próxima lectura. */
  nextReadingAt: number;
  /** La placa está conectada según el servidor (`device.online`). Distinto de `stale`, que decide si se riega con datos viejos. */
  reporting: boolean;
  /** Cómo está el wifi de la placa (decide si se muestra la guía para cargar una red nueva). */
  wifi: WifiState;
  /** 'aviso' = no hay regador conectado: el sistema solo avisa y el riego es manual. */
  relayMode: 'aviso' | 'real';
  /** Alerta abierta (solo en modo aviso): la tierra necesita agua y todavía no se anotó un riego. */
  needsWater: boolean;
};

/** Todo lo que se calcula a partir de una foto del sistema. Función pura. */
export function derive(s: Snapshot): Derived {
  const { now, settings, device } = s;
  const reading = latestReading(s.readings, now);

  const stale = !reading || now - reading.t > device.readEveryMin * 3 * 60_000;
  // La placa avisó que su sensor falla: la última humedad conocida ya no vale, aunque haya lecturas viejas.
  const sensorFault = !!device.sensor && !device.sensor.ok;
  // El estado del sensor lo dice el servidor (`device.sensor`): la pantalla no mira el valor crudo para decidirlo.
  const level = !sensorFault && reading ? levelOf(reading.moisture, settings.thresholdPct) : undefined;
  const status: Status = level ?? 'error';

  let lastWater: WaterEvent | undefined;
  for (const e of s.events) if (e.t <= now && (!lastWater || e.t > lastWater.t)) lastWater = e;

  const cycles = groupCycles(
    s.events.filter((e) => e.t <= now),
    device.readEveryMin,
  );

  const thisWeek = cycles.filter((c) => now - c.start < 7 * DAY).length;
  const prevWeek = cycles.filter((c) => now - c.start >= 7 * DAY && now - c.start < 14 * DAY).length;
  const first = s.readings[0];
  // Solo se compara si hay lecturas que cubran (casi) toda la semana anterior.
  const hasPrevious = !!first && first.t <= now - 14 * DAY + 12 * H;

  // Con el sensor en falla la decisión es bad-sensor: no riega ni pide riego (igual que el servidor).
  const decision: Decision = sensorFault
    ? { water: false, reason: 'bad-sensor' }
    : decideWatering({
        reading,
        settings,
        events: s.events,
        now,
        readEveryMin: device.readEveryMin,
      });
  // Conectada = lo que dice el servidor (`device.online`). No se vuelve a calcular acá.
  const reporting = device.online;
  const relayMode = device.relay === 'aviso' ? 'aviso' : 'real';

  return {
    reading,
    status,
    level,
    stale,
    forecast: forecastWatering(s.readings, s.events, settings.thresholdPct, now),
    decision,
    lastWater,
    lastCycle: cycles[cycles.length - 1],
    openCycle: openCycle(cycles, now, settings.mode, device.readEveryMin),
    weekly: { count: thisWeek, previous: hasPrevious ? prevWeek : null },
    nextReadingAt: device.lastSeen + device.readEveryMin * 60_000,
    reporting,
    wifi: wifiState(device, { reporting, loading: s.load === 'loading', serverError: !!s.error }),
    relayMode,
    // 'water' quiere decir: bajo el umbral, datos buenos y no hay un riego reciente. Anotar un riego la cierra.
    needsWater: relayMode === 'aviso' && decision.reason === 'water',
  };
}
