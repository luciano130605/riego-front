import { describe, expect, it } from 'vitest';
import { decideWatering, type DecideInput } from './decide';
import type { Settings, WaterEvent } from './types';

const H = 3_600_000;
const NOW = 1_800_000_000_000;

/** Riego de tiempo fijo, como en la primera versión. */
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

function input(patch: Partial<DecideInput> = {}): DecideInput {
  return {
    reading: { t: NOW, raw: 2300, moisture: 30 },
    settings,
    events: [],
    now: NOW,
    readEveryMin: 15,
    ...patch,
  };
}

const ev = (hoursAgo: number, source: WaterEvent['source'] = 'auto'): WaterEvent => ({
  t: NOW - hoursAgo * H,
  seconds: 8,
  source,
});

describe('decideWatering (tiempo fijo)', () => {
  it('riega cuando está seca, el automático está prendido y no hay restricciones', () => {
    expect(decideWatering(input())).toEqual({ water: true, reason: 'water' });
  });

  it('no riega sin lectura o con una lectura vieja', () => {
    expect(decideWatering(input({ reading: undefined })).reason).toBe('stale');
    const old = { t: NOW - 50 * 60_000, raw: 2300, moisture: 30 };
    expect(decideWatering(input({ reading: old })).reason).toBe('stale');
  });

  it('no riega si el valor crudo es imposible (cable suelto o corto)', () => {
    expect(decideWatering(input({ reading: { t: NOW, raw: 4095, moisture: 0 } })).reason).toBe(
      'bad-sensor',
    );
    expect(decideWatering(input({ reading: { t: NOW, raw: 0, moisture: 0 } })).reason).toBe(
      'bad-sensor',
    );
  });

  it('no riega si la humedad está sobre el umbral', () => {
    const reading = { t: NOW, raw: 2000, moisture: 50 };
    expect(decideWatering(input({ reading })).reason).toBe('not-needed');
  });

  it('avisa que haría falta pero el automático está apagado', () => {
    const d = decideWatering(input({ settings: { ...settings, auto: false } }));
    expect(d).toEqual({ water: false, reason: 'auto-off' });
  });

  it('espera el intervalo mínimo desde el último riego', () => {
    const d = decideWatering(input({ events: [ev(2)] }));
    expect(d.reason).toBe('too-soon');
    expect(d.waitHours).toBeCloseTo(4, 5);
  });

  it('cuenta también los riegos manuales para el intervalo mínimo', () => {
    const d = decideWatering(input({ events: [ev(1, 'manual')] }));
    expect(d.reason).toBe('too-soon');
  });

  it('respeta el máximo de riegos en 24 h y dice cuánto falta', () => {
    const s = { ...settings, minIntervalHours: 2 };
    const d = decideWatering(input({ settings: s, events: [ev(2), ev(5)] }));
    expect(d.reason).toBe('daily-cap');
    // Tiene que salir de la ventana el riego de hace 5 h: faltan 19 h.
    expect(d.waitHours).toBeCloseTo(19, 5);
  });

  it('con máximo por día en 0 nunca riega', () => {
    const d = decideWatering(input({ settings: { ...settings, maxPerDay: 0 } }));
    expect(d).toEqual({ water: false, reason: 'daily-cap' });
  });

  it('vuelve a regar cuando el riego anterior ya salió de la ventana', () => {
    const d = decideWatering(input({ events: [ev(7), ev(30)] }));
    expect(d.water).toBe(true);
  });
});

describe('decideWatering (hasta llegar al objetivo)', () => {
  const MIN = 60_000;
  const until: Settings = {
    ...settings,
    mode: 'until-target',
    waterSeconds: 5,
    maxCycleSeconds: 15,
    maxPerDay: null,
  };
  const at = (moisture: number) => ({ t: NOW, raw: 2300, moisture });
  const pulse = (minAgo: number, source: WaterEvent['source'] = 'auto'): WaterEvent => ({
    t: NOW - minAgo * MIN,
    seconds: 5,
    source,
  });
  const run = (patch: Partial<DecideInput> = {}) =>
    decideWatering(input({ settings: until, reading: at(30), ...patch }));

  it('arranca un riego cuando baja del umbral', () => {
    expect(run()).toEqual({ water: true, reason: 'water' });
  });

  it('después de una tanda espera a que el agua se reparta', () => {
    const d = run({ events: [pulse(15)], reading: at(38) });
    expect(d.reason).toBe('soaking');
    expect(d.water).toBe(false);
    // Faltan unos 28 min (45 menos 2 de tolerancia, menos los 15 que pasaron).
    expect(d.waitHours! * 60).toBeCloseTo(28, 5);
  });

  it('pasada la pausa, sigue con otra tanda si no llegó al objetivo', () => {
    expect(run({ events: [pulse(45)], reading: at(45) })).toEqual({ water: true, reason: 'water' });
  });

  it('con la humedad bajo el umbral sigue sin esperar el intervalo mínimo', () => {
    // Pasaron 50 min: el intervalo de 6 h es entre riegos, no entre tandas del mismo.
    expect(run({ events: [pulse(50)] }).water).toBe(true);
  });

  it('termina el riego apenas la lectura llega al objetivo, aunque falte la pausa', () => {
    const d = run({ events: [pulse(15)], reading: at(56) });
    expect(d).toEqual({ water: false, reason: 'target-reached' });
  });

  it('no arranca un riego nuevo si está entre el umbral y el objetivo', () => {
    expect(run({ reading: at(45) }).reason).toBe('not-needed');
    // Tampoco si el riego anterior ya se cerró por el tiempo.
    expect(run({ events: [pulse(120)], reading: at(45) }).reason).toBe('not-needed');
  });

  it('respeta el tope de seguridad por riego', () => {
    // Tres tandas de 5 s = 15 s: es el tope.
    const events = [pulse(140), pulse(95), pulse(50)];
    expect(run({ events, reading: at(40) })).toEqual({ water: false, reason: 'cycle-limit' });
  });

  it('con el tope por riego sin alcanzar sigue regando', () => {
    const events = [pulse(95), pulse(50)];
    expect(run({ events, reading: at(40) }).water).toBe(true);
  });

  it('sin tope diario (los necesarios) deja arrancar todos los riegos que hagan falta', () => {
    const events = [pulse(7 * 60), pulse(14 * 60), pulse(21 * 60)];
    expect(run({ events }).water).toBe(true);
  });

  it('el máximo por día cuenta riegos completos, no tandas', () => {
    const tandas = [pulse(10 * 60 + 90), pulse(10 * 60 + 45), pulse(10 * 60)];
    const one = run({ settings: { ...until, maxPerDay: 1 }, events: tandas });
    expect(one.reason).toBe('daily-cap');
    // El riego empezó hace 11 h 30 min: se libera en 12 h 30 min.
    expect(one.waitHours).toBeCloseTo(12.5, 5);
    // Con dos permitidos, un riego de tres tandas todavía deja uno más.
    expect(run({ settings: { ...until, maxPerDay: 2 }, events: tandas }).water).toBe(true);
  });

  it('un riego a mano cuenta como un riego y no abre uno automático', () => {
    const manual = [pulse(8 * 60, 'manual')];
    expect(run({ settings: { ...until, maxPerDay: 1 }, events: manual }).reason).toBe('daily-cap');
    // Recién regado a mano: el intervalo mínimo frena, no se toma como riego en curso.
    expect(run({ events: [pulse(20, 'manual')] }).reason).toBe('too-soon');
  });

  it('con máximo por día en 0 nunca arranca', () => {
    expect(run({ settings: { ...until, maxPerDay: 0 } })).toEqual({ water: false, reason: 'daily-cap' });
  });

  it('apagar el automático en medio de un riego lo frena', () => {
    const d = run({ settings: { ...until, auto: false }, events: [pulse(50)], reading: at(40) });
    expect(d.reason).toBe('auto-off');
  });

  it('con datos dudosos no sigue regando, aunque haya un riego en curso', () => {
    const old = { t: NOW - 50 * MIN, raw: 2300, moisture: 30 };
    expect(run({ events: [pulse(50)], reading: old }).reason).toBe('stale');
    expect(run({ events: [pulse(50)], reading: { t: NOW, raw: 4095, moisture: 0 } }).reason).toBe(
      'bad-sensor',
    );
  });
});
