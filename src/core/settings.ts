import { clamp } from './moisture';
import type { Settings } from './types';

export const READ_EVERY_MIN = 15;

export const DEFAULT_SETTINGS: Settings = {
  auto: true,
  mode: 'until-target',
  thresholdPct: 35,
  targetPct: 55,
  waterSeconds: 5,
  maxCycleSeconds: 30,
  minIntervalHours: 6,
  maxPerDay: null,
  // Calibración provisoria hasta que se midan los valores reales del sensor.
  rawDry: 3100,
  rawWet: 1350,
};

/** Limita cada ajuste a un rango razonable. Sirve tanto para lo que viene de la UI como del almacenamiento. */
export function sanitizeSettings(base: Settings, patch: Partial<Settings>): Settings {
  const next: Settings = { ...base };
  if (typeof patch.auto === 'boolean') next.auto = patch.auto;
  if (patch.mode === 'until-target' || patch.mode === 'fixed') next.mode = patch.mode;
  if (isFiniteNumber(patch.thresholdPct)) next.thresholdPct = Math.round(clamp(patch.thresholdPct, 10, 70));
  if (isFiniteNumber(patch.targetPct)) next.targetPct = Math.round(clamp(patch.targetPct, 20, 95));
  // El objetivo siempre queda por encima del umbral, si no el riego no tendría sentido.
  next.targetPct = Math.min(95, Math.max(next.targetPct, next.thresholdPct + 5));
  if (isFiniteNumber(patch.waterSeconds)) next.waterSeconds = Math.round(clamp(patch.waterSeconds, 1, 60));
  if (isFiniteNumber(patch.maxCycleSeconds)) {
    next.maxCycleSeconds = Math.round(clamp(patch.maxCycleSeconds, 1, 300));
  }
  next.maxCycleSeconds = Math.max(next.maxCycleSeconds, next.waterSeconds);
  if (isFiniteNumber(patch.minIntervalHours)) {
    next.minIntervalHours = Math.round(clamp(patch.minIntervalHours, 2, 48));
  }
  if (patch.maxPerDay === null) next.maxPerDay = null;
  else if (isFiniteNumber(patch.maxPerDay)) next.maxPerDay = Math.round(clamp(patch.maxPerDay, 0, 6));

  const dry = isFiniteNumber(patch.rawDry) ? Math.round(patch.rawDry) : next.rawDry;
  const wet = isFiniteNumber(patch.rawWet) ? Math.round(patch.rawWet) : next.rawWet;
  // Dos puntos de calibración casi iguales darían porcentajes sin sentido.
  if (Math.abs(dry - wet) >= 200) {
    next.rawDry = dry;
    next.rawWet = wet;
  }
  return next;
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}
