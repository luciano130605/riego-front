import { groupCycles, openCycle, soakRemainingMs } from './cycles';
import { isSaneRaw } from './moisture';
import type { Reading, Settings, WaterEvent } from './types';

const H = 3_600_000;

export type Reason =
  | 'water' // hay que regar ahora
  | 'not-needed' // la humedad está por encima del umbral
  | 'auto-off' // haría falta, pero el automático está apagado
  | 'too-soon' // pasó poco desde el último riego
  | 'daily-cap' // ya se llegó al máximo de riegos en 24 h
  | 'soaking' // en medio de un riego: se espera a que el agua se reparta
  | 'target-reached' // el riego en curso llegó a la humedad objetivo
  | 'cycle-limit' // el riego en curso llegó al tope de seguridad
  | 'bad-sensor' // la lectura es imposible (cable suelto, corto)
  | 'stale'; // no llegan lecturas nuevas

export type Decision = {
  water: boolean;
  reason: Reason;
  /** Horas que faltan para poder regar (too-soon, daily-cap y soaking). */
  waitHours?: number;
};

export type DecideInput = {
  reading: Reading | undefined;
  settings: Settings;
  events: WaterEvent[];
  now: number;
  readEveryMin: number;
};

/**
 * Regla de riego automático. Es una función pura: hoy la usa el simulador
 * de la pantalla y más adelante la va a usar el backend sin cambios.
 *
 * El orden de los chequeos importa: primero se descartan los datos dudosos,
 * después se resuelve un riego que ya está en curso y recién al final se
 * decide si arranca uno nuevo.
 */
export function decideWatering(input: DecideInput): Decision {
  const { reading, settings, now, readEveryMin } = input;
  const events = input.events.filter((e) => e.t <= now);

  if (!reading || now - reading.t > readEveryMin * 3 * 60_000) {
    return { water: false, reason: 'stale' };
  }
  if (!isSaneRaw(reading.raw)) return { water: false, reason: 'bad-sensor' };

  const cycles = groupCycles(events, readEveryMin);
  const open = openCycle(cycles, now, settings.mode, readEveryMin);

  // Riego en curso: sigue hasta llegar al objetivo, sin volver a mirar el intervalo ni el tope diario.
  if (open) {
    if (reading.moisture >= settings.targetPct) return { water: false, reason: 'target-reached' };
    if (!settings.auto) return { water: false, reason: 'auto-off' };
    const remaining = soakRemainingMs(open.last, now);
    if (remaining > 0) return { water: false, reason: 'soaking', waitHours: remaining / H };
    if (open.seconds + settings.waterSeconds > settings.maxCycleSeconds) {
      return { water: false, reason: 'cycle-limit' };
    }
    return { water: true, reason: 'water' };
  }

  if (reading.moisture >= settings.thresholdPct) return { water: false, reason: 'not-needed' };
  if (!settings.auto) return { water: false, reason: 'auto-off' };

  const last = cycles[cycles.length - 1];
  if (last) {
    const sinceH = (now - last.last) / H;
    if (sinceH < settings.minIntervalHours) {
      return { water: false, reason: 'too-soon', waitHours: settings.minIntervalHours - sinceH };
    }
  }

  if (settings.maxPerDay !== null) {
    const inLast24h = cycles.filter((c) => now - c.start < 24 * H);
    if (settings.maxPerDay <= 0) return { water: false, reason: 'daily-cap' };
    if (inLast24h.length >= settings.maxPerDay) {
      // Hay que esperar a que salgan de la ventana los riegos que sobran.
      const lastToLeave = inLast24h[inLast24h.length - settings.maxPerDay];
      return { water: false, reason: 'daily-cap', waitHours: (lastToLeave.start + 24 * H - now) / H };
    }
  }

  return { water: true, reason: 'water' };
}
