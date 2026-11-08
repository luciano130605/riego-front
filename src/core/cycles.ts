import type { Settings, WaterEvent, WaterSource } from './types';

const MIN = 60_000;

/**
 * Pausa entre tandas de un mismo riego: el agua tarda en llegar al sensor y,
 * si se mide antes, se riega de más.
 */
export const SOAK_MIN = 45;

/** Las lecturas no llegan con precisión de segundos; se tolera un poco. */
const JITTER_MS = 2 * MIN;

/** Un riego completo: una o varias tandas de bomba seguidas. */
export type Cycle = {
  /** Cuándo arrancó la primera tanda. */
  start: number;
  /** Cuándo arrancó la última tanda. */
  last: number;
  /** Segundos de bomba en total. */
  seconds: number;
  pulses: number;
  source: WaterSource;
};

/** Cuánto puede pasar entre tandas para que sigan siendo el mismo riego. */
export function cycleGapMs(readEveryMin: number): number {
  return (SOAK_MIN + 1.5 * readEveryMin) * MIN;
}

/** Cuánto falta (en ms) para que se pueda volver a regar dentro de un riego en curso. */
export function soakRemainingMs(lastPulseAt: number, now: number): number {
  return Math.max(0, SOAK_MIN * MIN - JITTER_MS - (now - lastPulseAt));
}

/**
 * Agrupa los eventos de bomba en riegos: las tandas automáticas seguidas son
 * un solo riego y el riego a mano siempre va aparte. En tiempo fijo el
 * intervalo mínimo entre riegos (2 h o más) supera la ventana, así que cada
 * evento queda como su propio riego y el historial se lee igual en los dos modos.
 */
export function groupCycles(events: WaterEvent[], readEveryMin: number): Cycle[] {
  const gap = cycleGapMs(readEveryMin);
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const cycles: Cycle[] = [];
  for (const e of sorted) {
    const prev = cycles[cycles.length - 1];
    if (prev && e.source === 'auto' && prev.source === 'auto' && e.t - prev.last <= gap) {
      prev.last = e.t;
      prev.seconds += e.seconds;
      prev.pulses += 1;
    } else {
      cycles.push({ start: e.t, last: e.t, seconds: e.seconds, pulses: 1, source: e.source });
    }
  }
  return cycles;
}

/**
 * El riego automático que todavía puede seguir con otra tanda, si lo hay.
 * Solo existe en 'until-target' y mientras no haya pasado demasiado tiempo.
 */
export function openCycle(
  cycles: Cycle[],
  now: number,
  mode: Settings['mode'],
  readEveryMin: number,
): Cycle | undefined {
  if (mode !== 'until-target') return undefined;
  const c = cycles[cycles.length - 1];
  if (!c || c.source !== 'auto') return undefined;
  return now - c.last <= cycleGapMs(readEveryMin) ? c : undefined;
}
