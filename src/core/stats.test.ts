import { describe, expect, it } from 'vitest';
import { SOAK_MIN } from './cycles';
import { DEFAULT_SETTINGS } from './settings';
import { barDays, computeStats, cycleStats, dailyPump, decisionRuns, PERIOD_MS, type StatsInput } from './stats';
import type { Reading, WaterEvent } from './types';

const MIN = 60_000;
const H = 3_600_000;
const NOW = new Date(2026, 5, 10, 12, 0, 0).getTime();

const GOOD_RAW = 2200;
const BAD_RAW = 4095;

function r(t: number, moisture: number, extra: Partial<Reading> = {}): Reading {
  return { t, raw: GOOD_RAW, moisture, ...extra };
}

/** Lecturas cada 15 min entre `from` y `to` (inclusive) con la humedad que devuelva `f`. */
function series(from: number, to: number, f: (t: number) => number): Reading[] {
  const out: Reading[] = [];
  for (let t = from; t <= to; t += 15 * MIN) out.push(r(t, f(t)));
  return out;
}

const auto = (t: number, seconds = 5): WaterEvent => ({ t, seconds, source: 'auto' });
const manual = (t: number, seconds = 5): WaterEvent => ({ t, seconds, source: 'manual' });

function input(over: Partial<StatsInput> = {}): StatsInput {
  return { readings: [], events: [], settings: DEFAULT_SETTINGS, readEveryMin: 15, now: NOW, ...over };
}

describe('computeStats', () => {
  it('sin datos devuelve ceros y null, nunca números inventados', () => {
    const s = computeStats(input(), '7d');
    expect(s).toMatchObject({
      count: 0,
      auto: 0,
      manual: 0,
      pumpSeconds: 0,
      avgPumpSeconds: null,
      avgPulses: null,
      moisture: null,
      avgRise: null,
      riseSamples: 0,
      avgIntervalHours: null,
      dryPerDay: null,
      inRangePct: null,
      limitCuts: 0,
    });
  });

  it('con un solo riego hay total y promedio de bomba, pero no intervalo entre riegos', () => {
    const t = NOW - 5 * H;
    const s = computeStats(
      input({
        readings: series(NOW - 8 * H, NOW, (x) => (x < t ? 30 : 60)),
        events: [auto(t, 10)],
      }),
      '24h',
    );
    expect(s.count).toBe(1);
    expect(s.auto).toBe(1);
    expect(s.manual).toBe(0);
    expect(s.pumpSeconds).toBe(10);
    expect(s.avgPumpSeconds).toBe(10);
    expect(s.avgPulses).toBe(1);
    expect(s.avgIntervalHours).toBeNull();
  });

  it('cuenta riegos (no tandas): las tandas seguidas son un riego y el manual va aparte', () => {
    const t0 = NOW - 10 * H;
    const events = [auto(t0), auto(t0 + 50 * MIN), auto(t0 + 100 * MIN), manual(NOW - 2 * H, 8)];
    const s = computeStats(input({ events, readings: series(NOW - 12 * H, NOW, () => 50) }), '24h');
    expect(s.count).toBe(2);
    expect(s.auto).toBe(1);
    expect(s.manual).toBe(1);
    expect(s.pumpSeconds).toBe(23);
    expect(s.avgPulses).toBe(2); // (3 + 1) / 2
    expect(s.avgPumpSeconds).toBeCloseTo(11.5);
    expect(s.avgIntervalHours).toBeCloseTo(8); // de 10 h atrás a 2 h atrás
  });

  it('respeta los límites del período: un riego justo fuera no cuenta y uno justo en el borde sí', () => {
    const edge = NOW - PERIOD_MS['24h'];
    const out = computeStats(input({ events: [auto(edge - 1)] }), '24h');
    const inn = computeStats(input({ events: [auto(edge)] }), '24h');
    expect(out.count).toBe(0);
    expect(inn.count).toBe(1);
    // Un evento "del futuro" tampoco entra.
    expect(computeStats(input({ events: [auto(NOW + 1)] }), '24h').count).toBe(0);
  });

  it('la humedad promedio, mínima y máxima ignoran las lecturas de sensor inválido', () => {
    const readings = [
      r(NOW - 3 * H, 40),
      r(NOW - 2 * H, 60),
      r(NOW - 1 * H, 0, { raw: BAD_RAW }), // cable suelto: no vale
      r(NOW - 30 * MIN, 50),
    ];
    const s = computeStats(input({ readings }), '24h');
    expect(s.moisture).toEqual({ avg: 50, min: 40, max: 60 });
  });

  it('si todas las lecturas son inválidas no hay humedad ni tiempo en rango', () => {
    const readings = series(NOW - 3 * H, NOW, () => 0).map((x) => ({ ...x, raw: BAD_RAW }));
    const s = computeStats(input({ readings }), '24h');
    expect(s.moisture).toBeNull();
    expect(s.inRangePct).toBeNull();
  });

  it('tiempo en rango: porcentaje del tiempo con lecturas válidas sobre el umbral', () => {
    // 4 h bajo el umbral y 4 h sobre el umbral.
    const readings = series(NOW - 8 * H, NOW - 15 * MIN, (t) => (t < NOW - 4 * H ? 30 : 60));
    const s = computeStats(input({ readings, now: NOW - 15 * MIN + 15 * MIN }), '24h');
    expect(s.inRangePct).toBeCloseTo(50, 0);
  });

  it('un hueco sin lecturas no cuenta ni a favor ni en contra', () => {
    // Una lectura sobre el umbral hace 20 h y otra bajo el umbral ahora: el hueco de 20 h no se rellena.
    const readings = [r(NOW - 20 * H, 60), r(NOW - 15 * MIN, 20)];
    const s = computeStats(input({ readings }), '24h');
    // Cada lectura cubre como mucho 3 intervalos (45 min); la de 60 % y la de 20 % cubren 45 y 15 min.
    expect(s.inRangePct).toBeCloseTo((45 / 60) * 100, 0);
  });

  it('ritmo de secado: con menos de 2 puntos (en realidad menos de los que pide forecast) es null', () => {
    expect(computeStats(input({ readings: [r(NOW - H, 50)] }), '24h').dryPerDay).toBeNull();
    expect(computeStats(input({ readings: [r(NOW - H, 50), r(NOW - 30 * MIN, 49)] }), '24h').dryPerDay).toBeNull();
  });

  it('ritmo de secado: puntos por día, nunca negativo, sin contar lecturas inválidas', () => {
    const drying = series(NOW - 24 * H, NOW, (t) => 60 - ((t - (NOW - 24 * H)) / H) * 0.5); // -0,5 por hora = 12 por día
    const s = computeStats(input({ readings: drying }), '24h');
    expect(s.dryPerDay).toBeCloseTo(12, 0);

    const rising = series(NOW - 24 * H, NOW, (t) => 40 + ((t - (NOW - 24 * H)) / H) * 0.5);
    expect(computeStats(input({ readings: rising }), '24h').dryPerDay).toBe(0);

    // Un 0 % por sensor roto en el medio no tiene que torcer la pendiente.
    const withBad = drying.map((x, i) => (i === 40 ? { ...x, raw: BAD_RAW, moisture: 0 } : x));
    expect(computeStats(input({ readings: withBad }), '24h').dryPerDay).toBeCloseTo(12, 0);
  });
});

describe('cycleStats', () => {
  it('riego en curso: antes de la pausa no hay "después" y no entra en el promedio de subida', () => {
    const t = NOW - 20 * MIN;
    const readings = [...series(NOW - 3 * H, t, () => 30), r(NOW - 5 * MIN, 31)];
    const [c] = cycleStats(input({ readings, events: [auto(t)] }));
    expect(c.end).toBe('in-progress');
    expect(c.before).toBe(30);
    expect(c.after).toBeNull();
    expect(c.rise).toBeNull();
    const s = computeStats(input({ readings, events: [auto(t)] }), '24h');
    expect(s.avgRise).toBeNull();
    expect(s.riseSamples).toBe(0);
    expect(s.inProgress).toBe(1);
  });

  it('subida = primera lectura después de la pausa menos la última de antes del riego', () => {
    const t = NOW - 6 * H;
    const readings = series(NOW - 8 * H, NOW, (x) => (x <= t ? 30 : x < t + SOAK_MIN * MIN ? 36 : 52));
    const [c] = cycleStats(input({ readings, events: [auto(t)] }));
    expect(c.before).toBe(30);
    expect(c.after).toBe(52);
    expect(c.rise).toBe(22);
    expect(computeStats(input({ readings, events: [auto(t)] }), '24h').avgRise).toBe(22);
  });

  it('con varias tandas, "después" se mide desde la última tanda más la pausa', () => {
    const t0 = NOW - 6 * H;
    const t1 = t0 + 50 * MIN;
    const readings = series(NOW - 8 * H, NOW, (x) => (x <= t0 ? 30 : x < t1 + SOAK_MIN * MIN ? 40 : 56));
    const [c] = cycleStats(input({ readings, events: [auto(t0), auto(t1)] }));
    expect(c.pulses).toBe(2);
    expect(c.rise).toBe(26);
  });

  it('eventos sin lecturas alrededor: no se inventa nada y queda "sin confirmar"', () => {
    const [c] = cycleStats(input({ readings: [], events: [auto(NOW - 5 * H)] }));
    expect(c).toMatchObject({ before: null, after: null, rise: null, end: 'unconfirmed' });
    expect(computeStats(input({ events: [auto(NOW - 5 * H)] }), '24h').avgRise).toBeNull();
  });

  it('una lectura de "antes" muy vieja no sirve', () => {
    const t = NOW - 6 * H;
    const readings = [r(t - 10 * H, 30), ...series(t + SOAK_MIN * MIN, NOW, () => 50)];
    const [c] = cycleStats(input({ readings, events: [auto(t)] }));
    expect(c.before).toBeNull();
    expect(c.after).toBe(50);
    expect(c.rise).toBeNull();
  });

  it('lecturas de sensor inválido no sirven ni de antes ni de después', () => {
    const t = NOW - 6 * H;
    const bad = (x: number): Reading => ({ t: x, raw: BAD_RAW, moisture: 0 });
    const readings = [r(t - 30 * MIN, 30), bad(t - 15 * MIN), bad(t), bad(t + SOAK_MIN * MIN), r(t + SOAK_MIN * MIN + 15 * MIN, 50)];
    const [c] = cycleStats(input({ readings, events: [auto(t)] }));
    expect(c.before).toBe(30); // la inválida de justo antes se saltea
    expect(c.after).toBe(50);
  });

  it('el "después" no puede ser una lectura de otro riego', () => {
    const t0 = NOW - 20 * H;
    const t1 = NOW - 10 * H;
    // Entre el primer riego (más la pausa) y el segundo no hay ninguna lectura.
    const readings = [r(t0 - 15 * MIN, 30), r(t1 + SOAK_MIN * MIN, 55)];
    const [c0, c1] = cycleStats(input({ readings, events: [auto(t0), auto(t1)] }));
    expect(c0.after).toBeNull();
    expect(c1.after).toBe(55);
  });

  it('tope de seguridad: con la decisión guardada, el riego queda "cortado" y se cuenta', () => {
    const t = NOW - 6 * H;
    const events = [auto(t, 15), auto(t + 50 * MIN, 15)];
    const readings = [
      ...series(NOW - 8 * H, t, () => 30),
      r(t + 100 * MIN + SOAK_MIN * MIN - 50 * MIN, 44, { decision: { water: false, reason: 'cycle-limit' } }),
    ];
    // La lectura con la decisión cae justo después de la pausa de la última tanda.
    const after = events[1].t + SOAK_MIN * MIN;
    readings[readings.length - 1] = r(after, 44, { decision: { water: false, reason: 'cycle-limit' } });
    const [c] = cycleStats(input({ readings, events }));
    expect(c.end).toBe('limit');
    expect(computeStats(input({ readings, events }), '24h').limitCuts).toBe(1);
  });

  it('tope de seguridad sin decisión guardada: se deduce de que no llegó al objetivo', () => {
    const t = NOW - 6 * H;
    const events = [auto(t, 15), auto(t + 50 * MIN, 15)]; // 30 s = el tope por defecto
    const readings = series(NOW - 8 * H, NOW, (x) => (x <= t ? 30 : 44));
    expect(cycleStats(input({ readings, events }))[0].end).toBe('limit');
    // En cambio, si llegó al objetivo termina bien aunque haya gastado todo el tope.
    const ok = series(NOW - 8 * H, NOW, (x) => (x <= t ? 30 : 56));
    expect(cycleStats(input({ readings: ok, events }))[0].end).toBe('target');
  });

  it('otros finales: objetivo alcanzado, automático apagado y riego a mano', () => {
    const t = NOW - 6 * H;
    const after = t + SOAK_MIN * MIN;
    const base = series(NOW - 8 * H, t, () => 30);
    const target = [...base, r(after, 56, { decision: { water: false, reason: 'target-reached' } })];
    const off = [...base, r(after, 40, { decision: { water: false, reason: 'auto-off' } })];
    expect(cycleStats(input({ readings: target, events: [auto(t)] }))[0].end).toBe('target');
    expect(cycleStats(input({ readings: off, events: [auto(t)] }))[0].end).toBe('auto-off');
    expect(cycleStats(input({ readings: target, events: [manual(t)] }))[0].end).toBe('manual');
  });
});

describe('dailyPump', () => {
  it('suma segundos por día de calendario y cuenta riegos, del más viejo al de hoy', () => {
    const today = new Date(NOW);
    const at = (daysAgo: number, h: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo, h).getTime();
    const events = [auto(at(0, 8), 5), auto(at(0, 11), 3), manual(at(2, 10), 7)]; // 8:00 y 11:00 son riegos distintos (el hueco supera la pausa)
    const readings = [r(at(4, 0), 50)];
    const bars = dailyPump(input({ events, readings }), 5);
    expect(bars).toHaveLength(5);
    expect(bars.map((b) => b.seconds)).toEqual([0, 0, 7, 0, 8]);
    expect(bars[2].cycles).toBe(1);
    expect(bars[4].cycles).toBe(2);
    expect(bars[0].dayStart).toBeLessThan(bars[4].dayStart);
  });

  it('los días anteriores al primer dato son "sin dato", no cero', () => {
    const bars = dailyPump(input({ readings: [r(NOW - 2 * 24 * H, 50)] }), 5);
    expect(bars.map((b) => b.seconds)).toEqual([null, null, 0, 0, 0]);
  });

  it('sin ningún dato, todos son "sin dato"', () => {
    expect(dailyPump(input(), 3).every((b) => b.seconds === null)).toBe(true);
  });

  it('el selector de período define cuántos días se muestran', () => {
    expect(barDays('24h')).toBe(14);
    expect(barDays('7d')).toBe(14);
    expect(barDays('30d')).toBe(30);
  });
});

describe('decisionRuns', () => {
  const d = (water: boolean, reason: string) => ({ decision: { water, reason } });

  it('agrupa lecturas consecutivas con el mismo motivo, del más nuevo al más viejo', () => {
    const readings = [
      r(NOW - 5 * H, 50, d(false, 'not-needed')),
      r(NOW - 5 * H + 15 * MIN, 50, d(false, 'not-needed')),
      r(NOW - 5 * H + 30 * MIN, 34, d(true, 'water')),
      r(NOW - 5 * H + 45 * MIN, 36, d(false, 'soaking')),
      r(NOW - 5 * H + 60 * MIN, 37, d(false, 'soaking')),
    ];
    const runs = decisionRuns(readings, NOW);
    expect(runs.map((x) => [x.reason, x.count])).toEqual([
      ['soaking', 2],
      ['water', 1],
      ['not-needed', 2],
    ]);
    expect(runs[2].from).toBe(NOW - 5 * H);
    expect(runs[2].to).toBe(NOW - 5 * H + 15 * MIN);
  });

  it('solo mira las últimas 48 h y saltea lecturas sin decisión guardada', () => {
    const readings = [
      r(NOW - 49 * H, 50, d(false, 'not-needed')),
      r(NOW - 3 * H, 50), // vieja, de antes de que se guardara la decisión
      r(NOW - 2 * H, 50, d(false, 'not-needed')),
    ];
    const runs = decisionRuns(readings, NOW);
    expect(runs).toHaveLength(1);
    expect(runs[0].count).toBe(1);
    expect(decisionRuns([r(NOW - H, 50)], NOW)).toEqual([]);
  });

  it('"solo cuando regó o hubo un problema" deja afuera lo rutinario', () => {
    const readings = [
      r(NOW - 6 * H, 50, d(false, 'not-needed')),
      r(NOW - 5 * H, 33, d(true, 'water')),
      r(NOW - 4 * H, 40, d(false, 'soaking')),
      r(NOW - 3 * H, 0, { raw: BAD_RAW, ...d(false, 'bad-sensor') }),
      r(NOW - 2 * H, 44, d(false, 'cycle-limit')),
    ];
    const runs = decisionRuns(readings, NOW, { onlyRelevant: true });
    expect(runs.map((x) => x.reason)).toEqual(['cycle-limit', 'bad-sensor', 'water']);
    // Con el sensor roto la humedad no es un dato.
    expect(runs[1].moistureFrom).toBeNull();
    expect(runs.every((x) => x.water || x.problem)).toBe(true);
  });
});
