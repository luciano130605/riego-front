import { groupCycles, SOAK_MIN, type Cycle } from './cycles';
import { dryingRate } from './forecast';
import { isSaneRaw } from './moisture';
import type { Reading, Settings, WaterEvent } from './types';

/**
 * Estadísticas de riego. Todo son funciones puras (sin React ni reloj propio): reciben
 * lecturas, eventos, ajustes y la hora actual, y devuelven números o `null` cuando no hay
 * datos suficientes. Nunca se inventa un valor: la pantalla muestra "Sin dato".
 * El backend puede importar este archivo tal cual.
 */

const MIN = 60_000;
const H = 3_600_000;

export type Period = '24h' | '7d' | '30d';
export const PERIODS: Period[] = ['24h', '7d', '30d'];
export const PERIOD_MS: Record<Period, number> = { '24h': 24 * H, '7d': 7 * 24 * H, '30d': 30 * 24 * H };

/** Razones de decide.ts que son un problema (no un simple "todavía no toca"). */
export const PROBLEM_REASONS: readonly string[] = ['bad-sensor', 'stale', 'cycle-limit'];

export type StatsInput = {
  readings: Reading[];
  events: WaterEvent[];
  settings: Settings;
  readEveryMin: number;
  now: number;
};

/** Cómo terminó un riego. */
export type CycleEnd =
  | 'target' // llegó a la humedad objetivo
  | 'limit' // lo cortó el tope de seguridad sin llegar al objetivo
  | 'auto-off' // se apagó el automático a mitad de riego
  | 'in-progress' // todavía no pasó la pausa que hace falta para medir el resultado
  | 'unconfirmed' // no hay una lectura que permita saberlo
  | 'manual'; // riego a mano: no tiene objetivo

export type CycleStat = Cycle & {
  /** Humedad de la última lectura válida anterior al inicio del riego. */
  before: number | null;
  /** Humedad de la primera lectura válida posterior a la última tanda más la pausa. */
  after: number | null;
  /** after − before, en puntos de humedad. Solo existe si se conocen los dos. */
  rise: number | null;
  end: CycleEnd;
};

type SaneList = Reading[];

function saneSorted(readings: Reading[], now: number): SaneList {
  return readings.filter((r) => r.t <= now && isSaneRaw(r.raw)).sort((a, b) => a.t - b.t);
}

/** Índice de la primera lectura con t >= x (o length si no hay). */
function lowerBound(list: { t: number }[], x: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Cada riego con la humedad de antes y de después, y cómo terminó.
 * - antes: última lectura válida anterior al inicio (si tiene menos de 3 intervalos de antigüedad).
 * - después: primera lectura válida desde que pasó la pausa (SOAK_MIN) posterior a la última tanda,
 *   siempre que no sea de otro riego ni esté muy atrasada.
 * - mientras no pasó esa pausa, el riego está "en curso" y no tiene subida.
 */
export function cycleStats(input: StatsInput): CycleStat[] {
  const { settings, readEveryMin, now } = input;
  const events = input.events.filter((e) => e.t <= now);
  const cycles = groupCycles(events, readEveryMin);
  const sane = saneSorted(input.readings, now);
  const all = input.readings.filter((r) => r.t <= now).sort((a, b) => a.t - b.t);
  const staleMs = readEveryMin * 3 * MIN;

  return cycles.map((c, i) => {
    const nextStart = cycles[i + 1]?.start ?? Infinity;

    const bi = lowerBound(sane, c.start + 1) - 1; // última con t <= start
    const prev = bi >= 0 ? sane[bi] : undefined;
    const before = prev && c.start - prev.t <= staleMs ? prev.moisture : null;

    const afterAt = c.last + SOAK_MIN * MIN;
    if (now < afterAt) {
      return { ...c, before, after: null, rise: null, end: 'in-progress' as const };
    }

    const ai = lowerBound(sane, afterAt);
    const post = sane[ai];
    const after = post && post.t < nextStart && post.t - afterAt <= staleMs ? post.moisture : null;
    const rise = before !== null && after !== null ? after - before : null;

    if (c.source === 'manual') return { ...c, before, after, rise, end: 'manual' as const };

    // La decisión que cortó el riego se guarda en la primera lectura de después de la pausa.
    const di = lowerBound(all, afterAt);
    const decided = all[di] && all[di].t < nextStart ? all[di].decision?.reason : undefined;
    let end: CycleEnd | undefined;
    if (decided === 'target-reached') end = 'target';
    else if (decided === 'cycle-limit') end = 'limit';
    else if (decided === 'auto-off') end = 'auto-off';

    // Sin decisión guardada (lecturas viejas): se deduce de la humedad y del tope.
    if (!end && after !== null) {
      if (after >= settings.targetPct) end = 'target';
      else if (settings.mode === 'until-target' && c.seconds + settings.waterSeconds > settings.maxCycleSeconds) {
        end = 'limit';
      }
    }
    return { ...c, before, after, rise, end: end ?? ('unconfirmed' as const) };
  });
}

export type Stats = {
  /** Riegos que empezaron en el período. */
  count: number;
  auto: number;
  manual: number;
  /** Segundos de bomba en total. */
  pumpSeconds: number;
  avgPumpSeconds: number | null;
  avgPulses: number | null;
  moisture: { avg: number; min: number; max: number } | null;
  /** Subida promedio por riego, en puntos. Solo cuenta riegos cuyo resultado ya se puede medir. */
  avgRise: number | null;
  /** Cuántos riegos entraron en el promedio de subida. */
  riseSamples: number;
  /** Cuántos riegos siguen en curso (no entran en el promedio). */
  inProgress: number;
  avgIntervalHours: number | null;
  /** Puntos de humedad que pierde por día desde el último riego. */
  dryPerDay: number | null;
  /** Porcentaje del tiempo con lecturas válidas en que la humedad estuvo sobre el umbral. */
  inRangePct: number | null;
  /** Riegos cortados por el tope de seguridad. */
  limitCuts: number;
};

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Porcentaje del tiempo cubierto por lecturas válidas en que la humedad estuvo sobre el umbral. */
function timeInRange(readings: Reading[], from: number, now: number, thresholdPct: number, capMs: number): number | null {
  const inPeriod = readings.filter((r) => r.t >= from && r.t <= now).sort((a, b) => a.t - b.t);
  let covered = 0;
  let good = 0;
  for (let i = 0; i < inPeriod.length; i++) {
    const r = inPeriod[i];
    if (!isSaneRaw(r.raw)) continue;
    const nextT = inPeriod[i + 1]?.t ?? now;
    const w = Math.min(Math.max(0, nextT - r.t), capMs);
    covered += w;
    if (r.moisture >= thresholdPct) good += w;
  }
  return covered > 0 ? (good / covered) * 100 : null;
}

/** Resumen del período. Función pura. */
export function computeStats(input: StatsInput, period: Period): Stats {
  const { settings, readEveryMin, now } = input;
  const from = now - PERIOD_MS[period];
  const cycles = cycleStats(input).filter((c) => c.start >= from && c.start <= now);

  const sane = saneSorted(input.readings, now);
  const inPeriod = sane.filter((r) => r.t >= from);
  const moisture = inPeriod.length
    ? {
        avg: mean(inPeriod.map((r) => r.moisture)) as number,
        min: Math.min(...inPeriod.map((r) => r.moisture)),
        max: Math.max(...inPeriod.map((r) => r.moisture)),
      }
    : null;

  const rises = cycles.filter((c) => c.rise !== null).map((c) => c.rise as number);
  const gaps: number[] = [];
  for (let i = 1; i < cycles.length; i++) gaps.push((cycles[i].start - cycles[i - 1].start) / H);

  const rate = dryingRate(sane, input.events, now, PERIOD_MS[period] / H);
  const pumpSeconds = cycles.reduce((a, c) => a + c.seconds, 0);

  return {
    count: cycles.length,
    auto: cycles.filter((c) => c.source === 'auto').length,
    manual: cycles.filter((c) => c.source === 'manual').length,
    pumpSeconds,
    avgPumpSeconds: cycles.length ? pumpSeconds / cycles.length : null,
    avgPulses: mean(cycles.map((c) => c.pulses)),
    moisture,
    avgRise: mean(rises),
    riseSamples: rises.length,
    inProgress: cycles.filter((c) => c.end === 'in-progress').length,
    avgIntervalHours: mean(gaps),
    dryPerDay: rate === null ? null : Math.max(0, -rate * 24),
    inRangePct: timeInRange(input.readings, from, now, settings.thresholdPct, readEveryMin * 3 * MIN),
    limitCuts: cycles.filter((c) => c.end === 'limit').length,
  };
}

// --- Riegos por día --------------------------------------------------------------

export type DayBar = {
  /** Medianoche local del día, en ms. */
  dayStart: number;
  /** Segundos de bomba ese día. null si todavía no había ningún dato. */
  seconds: number | null;
  /** Riegos (no tandas) que empezaron ese día. */
  cycles: number;
};

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Segundos de bomba por día de calendario, de los últimos `days` días, del más viejo al de hoy. */
export function dailyPump(input: StatsInput, days: number): DayBar[] {
  const { now, readEveryMin } = input;
  const events = input.events.filter((e) => e.t <= now);
  const cycles = groupCycles(events, readEveryMin);

  const firsts = [...input.readings.map((r) => r.t), ...events.map((e) => e.t)].filter((t) => t <= now);
  const firstData = firsts.length ? startOfDay(Math.min(...firsts)) : Infinity;

  const today = new Date(startOfDay(now));
  const bars: DayBar[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dayStart = d.getTime();
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    const nextStart = next.getTime();
    const seconds = events.filter((e) => e.t >= dayStart && e.t < nextStart).reduce((a, e) => a + e.seconds, 0);
    bars.push({
      dayStart,
      seconds: dayStart < firstData ? null : seconds,
      cycles: cycles.filter((c) => c.start >= dayStart && c.start < nextStart).length,
    });
  }
  return bars;
}

/** Cuántos días muestra el gráfico según el período elegido. */
export function barDays(period: Period): number {
  return period === '30d' ? 30 : 14;
}

// --- Decisiones ------------------------------------------------------------------

export type DecisionRun = {
  from: number;
  to: number;
  /** Cantidad de lecturas seguidas con la misma decisión. */
  count: number;
  reason: string;
  water: boolean;
  /** Humedad de la primera y de la última lectura del tramo (null si el sensor dio un valor imposible). */
  moistureFrom: number | null;
  moistureTo: number | null;
  problem: boolean;
};

/**
 * Decisiones de las últimas horas, con las lecturas consecutivas que tuvieron el mismo
 * resultado juntas en una sola línea. Del más nuevo al más viejo. Las lecturas sin
 * decisión guardada (anteriores a que se registrara) se saltean.
 */
export function decisionRuns(
  readings: Reading[],
  now: number,
  opts: { windowMs?: number; onlyRelevant?: boolean } = {},
): DecisionRun[] {
  const from = now - (opts.windowMs ?? 48 * H);
  const list = readings
    .filter((r) => r.decision && r.t >= from && r.t <= now)
    .sort((a, b) => a.t - b.t);

  const runs: DecisionRun[] = [];
  for (const r of list) {
    const d = r.decision!;
    const m = isSaneRaw(r.raw) ? r.moisture : null;
    const last = runs[runs.length - 1];
    if (last && last.reason === d.reason && last.water === d.water) {
      last.to = r.t;
      last.count += 1;
      last.moistureTo = m;
    } else {
      runs.push({
        from: r.t,
        to: r.t,
        count: 1,
        reason: d.reason,
        water: d.water,
        moistureFrom: m,
        moistureTo: m,
        problem: PROBLEM_REASONS.includes(d.reason),
      });
    }
  }
  const out = opts.onlyRelevant ? runs.filter((r) => r.water || r.problem) : runs;
  return out.reverse();
}
