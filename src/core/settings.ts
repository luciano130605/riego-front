import { clamp } from './moisture';
import type { QuietHours, Settings } from './types';

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
  quietHours: { enabled: false, from: '23:00', to: '07:00', tz: 'America/Argentina/Buenos_Aires' },
};

const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 'HH:mm' válido (00:00 a 23:59). */
export function isValidHm(v: unknown): v is string {
  return typeof v === 'string' && HM_RE.test(v);
}

/** Zona horaria IANA que el motor de Intl reconoce. */
export function isValidTimeZone(v: unknown): v is string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: v });
    return true;
  } catch {
    return false;
  }
}

/** Mezcla un cambio parcial sobre la ventana actual; lo que no es válido se ignora (la API lo rechaza antes con un 400). */
export function sanitizeQuietHours(base: QuietHours, patch: Partial<QuietHours>): QuietHours {
  const next = { ...base };
  if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
  if (isValidHm(patch.from)) next.from = patch.from;
  if (isValidHm(patch.to)) next.to = patch.to;
  if (isValidTimeZone(patch.tz)) next.tz = patch.tz;
  return next;
}

/** Limita cada ajuste a un rango razonable. Sirve tanto para lo que viene de la UI como del almacenamiento. */
export type SettingsPatch = Partial<Omit<Settings, 'quietHours'>> & { quietHours?: Partial<QuietHours> };

export function sanitizeSettings(base: Settings, patch: SettingsPatch): Settings {
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

  if (patch.quietHours && typeof patch.quietHours === 'object') {
    next.quietHours = sanitizeQuietHours(next.quietHours ?? (DEFAULT_SETTINGS.quietHours as QuietHours), patch.quietHours);
  }

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
